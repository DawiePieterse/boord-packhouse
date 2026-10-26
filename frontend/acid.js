// The Acid bath role: one card per bath with its health (days and crates
// since the chemicals were changed, the last concentration check), the batch
// in the bath with its dip countdown, the batches drying, the home tile, and
// Settings -> Acid.
//
// The sulfur tent's technique (sulfur.js): the same badge Operator, records
// made here with a tablet uuid and queued in Store's outbox (kind
// acid_batch / acid_change / acid_check), every timer worked out on this
// tablet from Store.now(). A batch moves one way: dipping -> drying -> done.
// An overrun dip sounds the alarm; drying past its time only says the fruit
// is ready to pack. Uses fmtClock, sourceLabel, findSource, soundAlarm,
// lastAlarm and renderOperatorBar from sulfur.js, and $, esc from app.js.

const acidDrafts = {};   // bath id -> {from, crates, dip, dry} being filled in
let acidSignature = "";  // what the cards were last built from

const dipping = () => Store.acidBatches().filter((b) => !b.dip_ended_at);
const drying = () => Store.acidBatches().filter((b) => b.dip_ended_at && !b.ended_at);
const activeBatches = () => Store.acidBatches().filter((b) => !b.ended_at);
const dipEndsAt = (b) => Date.parse(b.started_at) + b.dip_minutes * 60000;
const dryEndsAt = (b) => Date.parse(b.dip_ended_at) + b.dry_minutes * 60000;
const latest = (rows, key) => rows.reduce((best, r) => (!best || Date.parse(r[key]) > Date.parse(best[key]) ? r : best), null);

// Days and crates since the bath's last chemical change, and whether it is due.
//
// The server adds up the crates since its latest change (acid.py's /state
// `health`), because it no longer sends a bath's whole history. On top go
// this tablet's batches the server has not counted yet: those it has never
// had (not in /state's list, and not refused). A change made here and not yet
// sent restarts the count from it, out of the batches this tablet knows of -
// all made after that change, so all of them are here.
function bathHealth(bath) {
  const change = latest(Store.acidChanges().filter((c) => c.bath_id === bath.id), "changed_at");
  const since = change ? Date.parse(change.changed_at) : 0;
  const state = Store.acidState();
  const server = (state.health || []).find((h) => h.bath_id === bath.id);
  const mine = Store.acidBatches().filter((b) => b.bath_id === bath.id && Date.parse(b.started_at) >= since);
  const sum = (rows) => rows.reduce((n, b) => n + b.crates, 0);
  const listed = new Set((state.batches || []).map((b) => b.uuid));
  const crates = server && server.change_uuid === (change ? change.uuid : null)
    ? server.crates + sum(mine.filter((b) => b.synced === 0 && !listed.has(b.uuid)))
    : sum(mine);
  const days = change ? (Store.now() - since) / 864e5 : null;
  const check = latest(Store.acidChecks().filter((c) => c.bath_id === bath.id), "checked_at");
  return { change, crates, days, check, due: !change || days >= bath.change_days || crates >= bath.change_crates };
}

// Export fruit: a finished sulfur run not yet through a bath. Local fruit:
// straight from grading, chosen by block or supplier like a tent load.
function exportRuns() {
  // Dipped on any tablet in any bath, retired ones too (/state's used_runs),
  // or by a batch this tablet has not sent yet.
  const used = new Set([...(Store.acidState().used_runs || []), ...Store.acidBatches().map((b) => b.sulfur_run_uuid).filter(Boolean)]);
  return Store.runs().filter((r) => r.ended_at && !used.has(r.uuid))
    .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at));
}

function acidDraftFor(bath) {
  if (!acidDrafts[bath.id]) {
    const runs = exportRuns();
    acidDrafts[bath.id] = {
      // Pre-selected only when one sulfur load is waiting - with several,
      // the operator chooses, so nobody dips the wrong one.
      from: runs.length === 1 ? `run:${runs[0].uuid}` : "",
      crates: runs.length === 1 ? runs[0].crates : bath.default_crates,
      dip: bath.default_dip_minutes, dry: bath.default_dry_minutes,
    };
  }
  return acidDrafts[bath.id];
}

function fromOptions(selected) {
  const runs = exportRuns();
  const groups = Store.sources().filter((g) => g.sources.length);
  const opt = (value, label) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  return `<option value="">Choose the fruit...</option>`
    + `<optgroup label="Export - from the sulfur tent">${runs.map((r) => opt(`run:${r.uuid}`,
      `${r.tent_name} · ${sourceLabel(r)} · ${r.crates} crates · out ${Boord.fmtTime(new Date(Date.parse(r.ended_at)))}`)).join("")
      || `<option disabled>No finished sulfur runs waiting</option>`}</optgroup>`
    + groups.map((g) => `<optgroup label="Local - straight from grading (${esc(g.label)})">`
      + g.sources.map((s) => opt(`src:${s.key}`, sourceLabel(s))).join("") + `</optgroup>`).join("");
}

function healthStrip(bath) {
  const h = bathHealth(bath);
  const when = h.change
    ? `Chemicals changed ${h.days < 1 ? "today" : `${Math.floor(h.days)} day${Math.floor(h.days) === 1 ? "" : "s"} ago`} · ${h.crates} crates since`
    : `No chemical change logged yet · ${h.crates} crates`;
  const check = h.check
    ? `Last check: <b>${esc(h.check.value)}</b> at ${esc(Boord.fmtDateTime(new Date(Date.parse(h.check.checked_at))))} by ${esc(h.check.by_name || h.check.by)}`
    : "No concentration check yet";
  return `
    <div class="text-sm rounded-lg p-2 border ${h.due ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-green-50 text-green-900 border-green-200"}">
      <div>${h.due ? `<i class="fa-solid fa-triangle-exclamation"></i> <b>Change the chemicals</b> · ` : `<i class="fa-solid fa-circle-check"></i> `}${esc(when)}</div>
      <div class="text-xs opacity-80">Due every ${esc(bath.change_days)} days or ${esc(bath.change_crates)} crates · ${check}</div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-check-open class="border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid fa-vial"></i> Concentration check</button>
      <button type="button" data-changed class="border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid fa-rotate"></i> Chemicals changed</button>
    </div>
    <div data-check-row class="hidden grid grid-cols-3 gap-2">
      <input data-check-value type="number" step="any" inputmode="decimal" placeholder="Reading" class="border border-slate-300 rounded-lg p-3 text-xl">
      <input data-check-note placeholder="Note" class="border border-slate-300 rounded-lg p-3">
      <button type="button" data-check-save class="boord-btn-primary rounded-lg font-bold">Save</button>
    </div>`;
}

function startForm(bath) {
  const d = acidDraftFor(bath);
  const num = (field, label, value) => `<label class="block"><span class="text-xs text-slate-500">${label}</span>
    <input data-field="${field}" type="number" inputmode="numeric" min="1" step="1" value="${esc(value)}"
           class="w-full border border-slate-300 rounded-lg p-3 text-xl"></label>`;
  return `
    <label class="block"><span class="text-xs text-slate-500">Fruit</span>
      <select data-field="from" class="w-full border border-slate-300 rounded-lg p-3 text-lg bg-white">${fromOptions(d.from)}</select></label>
    <div class="grid grid-cols-3 gap-3">${num("crates", "Crates", d.crates)}${num("dip", "Dip (min)", d.dip)}${num("dry", "Dry (min)", d.dry)}</div>
    <button type="button" data-dip class="w-full boord-btn-primary rounded-xl py-4 text-xl font-bold">
      <i class="fa-solid fa-play"></i> Start dip</button>`;
}

function batchLine(b) {
  return `${esc(b.crates)} crates · ${b.route === "export" ? "Export" : "Local"} · ${esc(sourceLabel(b))}<br>
    Started ${esc(Boord.fmtTime(new Date(Date.parse(b.started_at))))} by ${esc(b.started_by_name || b.started_by)}
    ${b.synced === 0 ? `<br><span class="text-amber-700"><i class="fa-solid fa-cloud-arrow-up"></i> Not sent to the server yet</span>` : ""}`;
}

function dipBlock(b, several) {
  return `
    <div class="space-y-2${several ? " border-t pt-3" : ""}">
      <div class="text-center">
        <div data-acid-countdown="${esc(b.uuid)}" class="text-6xl font-mono font-bold"></div>
        <div data-acid-label="${esc(b.uuid)}" class="text-sm text-slate-500"></div>
      </div>
      <div class="text-sm text-slate-600 text-center">${batchLine(b)} · dip ${esc(b.dip_minutes)} min</div>
      <button type="button" data-out="${esc(b.uuid)}" class="w-full bg-green-600 text-white rounded-xl py-4 text-xl font-bold">
        <i class="fa-solid fa-arrow-up-from-bracket"></i> Out of the bath - start drying</button>
    </div>`;
}

function dryBlock(b) {
  return `
    <div data-dry-block class="space-y-2 rounded-xl border-2 p-3 bg-green-100 border-green-400">
      <div class="text-sm text-slate-700">
        <div><b>Drying</b> <span data-acid-countdown="${esc(b.uuid)}" class="font-mono font-bold"></span>
          <span data-acid-label="${esc(b.uuid)}"></span></div>
        ${batchLine(b)}
      </div>
      <button type="button" data-dry-done="${esc(b.uuid)}" class="w-full boord-btn-primary rounded-xl py-4 text-xl font-bold">
        <i class="fa-solid fa-check"></i> Dry - ready to pack</button>
    </div>`;
}

function bathCard(bath) {
  const dips = dipping().filter((b) => b.bath_id === bath.id);
  const dries = drying().filter((b) => b.bath_id === bath.id).sort((a, b) => dryEndsAt(a) - dryEndsAt(b));
  return `
    <div class="bg-white rounded-2xl shadow p-4 space-y-3" data-bath="${bath.id}"${dips.length ? " data-dipping-card" : ""}>
      <div class="flex items-center justify-between">
        <div class="text-2xl font-bold">${esc(bath.name)}</div>
        <span data-bath-badge class="text-xs px-2 py-1 rounded-full ${dips.length ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}">${dips.length ? "Dipping" : "Ready"}</span>
      </div>
      ${healthStrip(bath)}
      ${dips.length > 1 ? `<div class="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
        <i class="fa-solid fa-triangle-exclamation"></i> ${dips.length} batches are in this bath - probably started on two tablets while the Wi-Fi was down. Take each one out when it is done.</div>` : ""}
      ${dips.length ? dips.map((b) => dipBlock(b, dips.length > 1)).join("") : startForm(bath)}
      ${dries.map(dryBlock).join("")}
    </div>`;
}

// Rebuilt only when what the cards show changes, never by the 1-second tick
// - a rebuild would wipe whatever the operator is typing.
function renderAcid(force = false) {
  if ($("acid").classList.contains("hidden")) return;
  const op = Operator.current();
  const baths = Store.baths();
  const signature = JSON.stringify([baths, Store.acidBatches().map((b) => [b.uuid, b.synced, b.dip_ended_at, b.ended_at]),
    Store.acidChanges().map((c) => c.uuid), Store.acidChecks().map((c) => c.uuid), Store.acidState().health,
    exportRuns().map((r) => r.uuid), Store.sources(), op && op.id]);
  if (!force && signature === acidSignature) return;
  acidSignature = signature;

  renderOperatorBar($("acidOperatorBar"));
  $("bathCards").innerHTML = baths.length
    ? baths.map(bathCard).join("")
    : `<div class="bg-white rounded-2xl shadow p-6 text-center text-slate-500">No acid baths yet - add them in Settings &rarr; Acid.
       ${navigator.onLine ? "" : "<br>This tablet has not reached the server yet."}</div>`;
  acidTick();
}

// --------------------------------------------------------------------------
// Batches, changes and checks: into the outbox, like a sulfur run.
// --------------------------------------------------------------------------
const stamp = () => new Date(Store.now()).toISOString();

async function startDip(card) {
  const bath = Store.baths().find((b) => b.id === Number(card.dataset.bath));
  const op = Operator.current();
  if (!bath) return;
  if (!op) { show(); return; }
  const d = acidDraftFor(bath);
  const crates = Number(d.crates);
  const dip = Number(d.dip);
  const dry = Number(d.dry);
  const run = d.from.startsWith("run:") ? Store.runs().find((r) => r.uuid === d.from.slice(4)) : null;
  const source = run || (d.from.startsWith("src:") ? findSource(d.from.slice(4)) : null);
  if (!source) return Boord.toast("Choose the fruit");
  if (!(Number.isInteger(crates) && crates >= 1)) return Boord.toast("Enter the number of crates");
  if (!(dip >= 1 && dip <= 600 && dry >= 1 && dry <= 600)) return Boord.toast("Enter the dip and drying minutes");
  await Store.saveRun({
    kind: "acid_batch", uuid: Boord.uuid(), bath_id: bath.id, bath_name: bath.name,
    route: run ? "export" : "local", sulfur_run_uuid: run ? run.uuid : null,
    crates, dip_minutes: dip, dry_minutes: dry,
    block_id: source.block_id ?? null, block_name: source.block_name || "", variety: source.variety || "",
    supplier_id: source.supplier_id ?? null, supplier_name: source.supplier_name || "",
    started_at: stamp(), started_by: op.id, started_by_name: op.name,
    dip_ended_at: null, dip_ended_by: "", dip_ended_by_name: "", ended_at: null, ended_by: "", ended_by_name: "",
  });
  delete acidDrafts[bath.id];
  Boord.beepSaved();
}

async function advanceBatch(uuid, stage) {
  const b = Store.acidBatches().find((x) => x.uuid === uuid);
  const op = Operator.current();
  if (!b) return;
  if (!op) { show(); return; }
  const out = stage === "dip";
  if (!confirm(out ? `Out of ${b.bath_name}? Drying starts now.` : `${b.crates} crates dry and ready to pack?`)) return;
  await Store.saveRun(out
    ? { ...b, dip_ended_at: stamp(), dip_ended_by: op.id, dip_ended_by_name: op.name }
    : { ...b, ended_at: stamp(), ended_by: op.id, ended_by_name: op.name });
  Boord.beepSaved();
}

async function chemicalsChanged(bath) {
  const op = Operator.current();
  if (!op) { show(); return; }
  if (!confirm(`Chemicals changed in ${bath.name}? This starts its days and crates from zero.`)) return;
  await Store.saveRun({
    kind: "acid_change", uuid: Boord.uuid(), bath_id: bath.id, bath_name: bath.name,
    changed_at: stamp(), crates_since: bathHealth(bath).crates, by: op.id, by_name: op.name,
  });
  Boord.beepSaved();
}

async function saveCheck(card, bath) {
  const op = Operator.current();
  if (!op) { show(); return; }
  const value = card.querySelector("[data-check-value]").value;
  if (value === "" || !Number.isFinite(Number(value))) return Boord.toast("Enter the reading");
  await Store.saveRun({
    kind: "acid_check", uuid: Boord.uuid(), bath_id: bath.id, bath_name: bath.name,
    checked_at: stamp(), value: Number(value), note: card.querySelector("[data-check-note]").value.trim(),
    by: op.id, by_name: op.name,
  });
  Boord.beepSaved();
}

function onAcidInput(ev) {
  const card = ev.target.closest("[data-bath]");
  const field = ev.target.dataset.field;
  const bath = card && Store.baths().find((b) => b.id === Number(card.dataset.bath));
  if (!bath || !field) return;
  const d = acidDraftFor(bath);
  d[field] = ev.target.value;
  // A sulfur load brings its crate count with it.
  const run = field === "from" && d.from.startsWith("run:") && Store.runs().find((r) => r.uuid === d.from.slice(4));
  if (run) card.querySelector('[data-field="crates"]').value = d.crates = run.crates;
}

function onAcidClick(ev) {
  const card = ev.target.closest("[data-bath]");
  const bath = card && Store.baths().find((b) => b.id === Number(card.dataset.bath));
  const hit = (sel) => ev.target.closest(sel);
  if (hit("[data-dip]") && card) startDip(card);
  else if (hit("[data-out]")) advanceBatch(hit("[data-out]").dataset.out, "dip");
  else if (hit("[data-dry-done]")) advanceBatch(hit("[data-dry-done]").dataset.dryDone, "dry");
  else if (hit("[data-changed]") && bath) chemicalsChanged(bath);
  else if (hit("[data-check-open]") && card) card.querySelector("[data-check-row]").classList.toggle("hidden");
  else if (hit("[data-check-save]") && bath) saveCheck(card, bath);
}

// --------------------------------------------------------------------------
// The 1-second tick: countdowns, the home tile, the dip alarm.
// --------------------------------------------------------------------------
function acidTileStatus() {
  const el = $("tileStatus-acid");
  if (!el) return;
  const now = Store.now();
  const lines = Store.baths().map((bath) => {
    const dip = dipping().find((b) => b.bath_id === bath.id);
    const dry = drying().filter((b) => b.bath_id === bath.id).length;
    const parts = [];
    if (dip) {
      const left = dipEndsAt(dip) - now;
      parts.push(left > 0 ? `<span class="text-green-700">dip ${Math.ceil(left / 60000)} min left</span>`
        : `<span class="text-red-600 font-bold">dip +${Math.floor(-left / 60000)} min over</span>`);
    }
    if (dry) parts.push(`${dry} drying`);
    if (bathHealth(bath).due) parts.push(`<span class="text-amber-700">change chemicals</span>`);
    return parts.length ? `<div class="text-sm font-semibold">${esc(bath.name)}: ${parts.join(" · ")}</div>` : "";
  }).join("");
  el.innerHTML = lines || `<div class="text-xs text-slate-400 mt-1">No batches going</div>`;
}

function acidTick() {
  const now = Store.now();
  for (const b of activeBatches()) {
    const el = document.querySelector(`[data-acid-countdown="${CSS.escape(b.uuid)}"]`);
    if (!el) continue;
    const label = document.querySelector(`[data-acid-label="${CSS.escape(b.uuid)}"]`);
    const left = (b.dip_ended_at ? dryEndsAt(b) : dipEndsAt(b)) - now;
    if (!b.dip_ended_at) {
      el.textContent = left > 0 ? fmtClock(left) : `+${fmtClock(left)}`;
      el.classList.toggle("text-red-600", left <= 0);
      el.classList.toggle("text-green-700", left > 0);
      label.textContent = left > 0 ? "left in the bath" : "OVER TIME - take it out";
      const card = el.closest("[data-dipping-card]");
      card.classList.toggle("ring-4", left <= 0);
      card.classList.toggle("ring-red-500", left <= 0);
      const badge = card.querySelector("[data-bath-badge]");
      badge.textContent = left > 0 ? "Dipping" : "Time's up";
      badge.className = `text-xs px-2 py-1 rounded-full ${left > 0 ? "bg-amber-100 text-amber-800" : "bg-red-600 text-white"}`;
    } else {
      el.textContent = left > 0 ? fmtClock(left) : "";
      label.textContent = left > 0 ? "left" : "- dry, ready to pack";
      label.classList.toggle("text-green-700", left <= 0);
      // Green while inside the drying time, amber with a red edge once past it.
      const block = el.closest("[data-dry-block]");
      for (const c of ["bg-green-100", "border-green-400"]) block.classList.toggle(c, left > 0);
      for (const c of ["bg-amber-200", "border-red-500"]) block.classList.toggle(c, left <= 0);
    }
  }
  acidTileStatus();

  // A dip left too long sounds the alarm on the acid and home screens until
  // it is taken out. Shares lastAlarm with the tents, so they never overlap.
  const overdue = dipping().some((b) => dipEndsAt(b) <= now);
  const visible = !$("acid").classList.contains("hidden") || !$("home").classList.contains("hidden");
  if (overdue && visible && document.visibilityState === "visible" && Date.now() - lastAlarm >= ALARM_EVERY_MS) {
    lastAlarm = Date.now();
    soundAlarm();
  }
  if (!$("acid").classList.contains("hidden") && !Operator.current()) show();
}

// --------------------------------------------------------------------------
// Settings -> Acid: the baths (behind the PIN; uses unlocked and show from app.js)
// --------------------------------------------------------------------------
const BATH_FIELDS = [
  ["default_dip_minutes", "Dip (min)"], ["default_dry_minutes", "Dry (min)"], ["default_crates", "Crates"],
  ["change_days", "Change every (days)"], ["change_crates", "or every (crates)"],
];

function bathRow(b) {
  const isNew = b.id == null;
  return `
    <form class="bg-white rounded-2xl shadow p-4 space-y-3" data-bath-form="${isNew ? "new" : b.id}">
      <div class="flex items-center justify-between gap-3">
        <input name="name" value="${esc(b.name)}" placeholder="Bath name" class="flex-1 border border-slate-300 rounded-lg p-2 text-lg font-semibold">
        ${isNew ? "" : `<label class="text-sm flex items-center gap-2"><input name="active" type="checkbox"${b.active ? " checked" : ""} class="w-5 h-5"> In use</label>`}
      </div>
      <div class="grid grid-cols-3 gap-2">${BATH_FIELDS.map(([key, label]) => `
        <label class="block"><span class="text-xs text-slate-500">${label}</span>
          <input name="${key}" type="number" step="any" inputmode="decimal" value="${esc(b[key])}" class="w-full border border-slate-300 rounded-lg p-2"></label>`).join("")}
      </div>
      <button class="w-full ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg py-2 font-semibold">${isNew ? "Add bath" : "Save"}</button>
    </form>`;
}

async function loadBathSettings() {
  let baths;
  try {
    baths = await Boord.api("/api/settings/baths");
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("bathSettings").innerHTML = `<div class="text-sm text-slate-500">Baths can only be changed while the server can be reached.</div>`;
    return;
  }
  $("bathSettings").innerHTML = baths.map(bathRow).join("")
    + `<div class="text-sm font-semibold text-slate-600 pt-2">Add a bath</div>`
    + bathRow({ id: null, name: "", default_dip_minutes: 5, default_dry_minutes: 30, default_crates: 24,
                change_days: 3.5, change_crates: 500, active: true });
}

async function saveBath(ev) {
  const form = ev.target.closest("[data-bath-form]");
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form);
  const isNew = form.dataset.bathForm === "new";
  const body = { name: f.get("name"), active: isNew ? true : f.get("active") === "on" };
  for (const [key] of BATH_FIELDS) body[key] = Number(f.get(key));
  try {
    await Boord.api(isNew ? "/api/settings/baths" : `/api/settings/baths/${form.dataset.bathForm}`,
      { method: isNew ? "POST" : "PUT", body });
    Boord.toast(isNew ? "Bath added" : "Bath saved");
    await loadBathSettings();
    Store.syncNow(); // the acid screen picks the change up
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

function initAcid() {
  $("bathCards").addEventListener("click", onAcidClick);
  $("bathCards").addEventListener("input", onAcidInput);
  $("bathCards").addEventListener("change", onAcidInput);
  $("bathSettings").addEventListener("submit", saveBath);
  Store.onChange(() => renderAcid());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") acidTick(); });
  setInterval(acidTick, 1000);
}
