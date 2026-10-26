// The Delivery Note role (the paper Afleweringsnota) on a phone: the recent
// notes, then one note to fill in - receiver and transporter (picked from
// Settings -> Delivery Note), seal, cooled to, the loading and offloading
// dates, and the pallets on the truck, ticked off the Pallet Stack list and
// shown as it shows them - and its PDF, laid out as the paper note, to print
// or share.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// delivery_note), editable like a pallet (consignment.js): saving again
// re-queues the whole record (rev). The note keeps its own copy of each
// pallet (the server's, taken when it is saved), so a pallet edited later
// leaves a note that has gone out as it was. Opens with the badge scan; a
// note keeps who made it and who last changed it. Uses Operator and
// renderOperatorBar from sulfur.js, $, esc from app.js and palletSummary,
// palletCartons, palletKg, kgText and sum from consignment.js.

let dn = { view: "list", draft: null };

const dnToday = () => new Date(Store.now()).toLocaleDateString("en-CA"); // YYYY-MM-DD, farm-local
const dnDay = (v) => (v ? v.split("-").reverse().join("/") : "");
// The number runs on from the highest note: typed once, carrying on from the paper book.
function nextNoteNo() {
  const used = Store.notes().map((n) => n.note_no);
  return used.length ? String(Math.max(...used) + 1) : "";
}
const receiverText = (r) => [r.name, r.market, r.city].filter(Boolean).join("\n");
const noteTotals = (pallets) => `<b>${pallets.length}</b> pallet${pallets.length === 1 ? "" : "s"} · <b>${sum(pallets, palletCartons)}</b> cartons · <b>${kgText(sum(pallets, palletKg))}</b>`;

function renderDeliveryNote() {
  renderOperatorBar($("deliveryOperatorBar"));
  $("deliveryOperatorBar").classList.toggle("hidden", dn.view === "note");
  $("deliveryBody").innerHTML = dn.view === "note" ? noteForm() : notesView();
}

function notesView() {
  const rows = Store.notes().slice(0, 30).map((n) => `
    <button type="button" data-note="${esc(n.uuid)}" class="w-full text-left border-t py-2 active:bg-slate-50">
      <div class="flex justify-between gap-3 items-baseline">
        <div class="font-bold text-lg">Note ${esc(n.note_no)}</div>
        <div class="text-sm shrink-0">${esc(dnDay(n.loaded_on))}</div>
      </div>
      <div class="text-sm truncate">${esc(n.receiver.split("\n")[0])}${n.transporter ? ` · ${esc(n.transporter)}` : ""}</div>
      <div class="text-sm">${noteTotals(n.pallets)}</div>
      <div class="text-xs text-slate-500 truncate">Pallets ${n.pallets.map((p) => esc(p.pallet_ref)).join(", ")}</div>
      ${n.error ? `<div class="text-sm text-red-600 mt-1">Not saved: ${esc(n.error)}. Tap to fix it.</div>` : ""}
    </button>`).join("");
  return `
    <div class="bg-white rounded-2xl shadow p-4">
      <button type="button" data-addnote class="w-full boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-file-lines"></i> New delivery note</button>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Recent delivery notes</div>
        <div class="text-xs text-white/80">Tap a note to edit, print or share it.</div>
      </div>
      ${rows || `<div class="text-center text-slate-400 text-sm py-6 border-t">No delivery notes yet</div>`}
    </div>`;
}

function openNote(note) {
  const opts = Store.noteOptions();
  dn.view = "note";
  dn.draft = note
    ? { uuid: note.uuid, note, no: String(note.note_no), receiver_id: note.receiver_id, transporter_id: note.transporter_id,
        seal_no: note.seal_no, cooled_to: note.cooled_to, loaded_on: note.loaded_on, offloaded_on: note.offloaded_on,
        picked: note.pallets.map((p) => p.uuid) }
    : { uuid: Boord.uuid(), note: null, no: nextNoteNo(), receiver_id: null, transporter_id: null, seal_no: "",
        cooled_to: opts.cooled_to == null ? "" : String(opts.cooled_to), loaded_on: dnToday(), offloaded_on: "", picked: [] };
  renderDeliveryNote();
}

// Settings' list plus the note's own pick if it has since been retired, so
// editing an old note loses nothing (withOwn from consignment.js).
const receiverChoices = (d) => withOwn(Store.noteOptions().receivers || [],
  d.note && d.note.receiver_id != null && { id: d.note.receiver_id, name: d.note.receiver.split("\n")[0], text: d.note.receiver });
const transporterChoices = (d) => withOwn(Store.noteOptions().transporters || [],
  d.note && d.note.transporter_id != null && { id: d.note.transporter_id, name: d.note.transporter });

// The pallets this note can hold: its own (the live copy if this phone has
// one, else the note's), then every pallet on no other note, newest first.
function palletChoices(d) {
  const taken = new Set(Store.notes().filter((n) => n.uuid !== d.uuid).flatMap((n) => n.pallets.map((p) => p.uuid)));
  const live = newestFirst().filter((p) => !taken.has(p.uuid) && !p.error);
  const own = (d.note ? d.note.pallets : []).filter((p) => !live.some((l) => l.uuid === p.uuid));
  return [...own, ...live];
}

function noteForm() {
  const d = dn.draft;
  const field = "w-full border border-slate-300 rounded-lg px-2 py-2.5";
  const label = (text, html, cls = "block") => `<label class="${cls}"><span class="text-xs font-semibold text-slate-600">${text}</span>${html}</label>`;
  const input = (f, extra = "") => `<input data-field="${f}" value="${esc(d[f])}" ${extra} class="${field}">`;
  const select = (f, rows, picked, blank, text) => `<select data-field="${f}" class="${field}"><option value="">${blank}</option>`
    + rows.map((r) => `<option value="${esc(r.id)}"${r.id === picked ? " selected" : ""}>${esc(text(r))}</option>`).join("") + `</select>`;
  const choices = palletChoices(d);
  const picked = choices.filter((p) => d.picked.includes(p.uuid));
  const pallets = choices.map((p) => {
    const on = d.picked.includes(p.uuid);
    return `
    <button type="button" data-pick="${esc(p.uuid)}" class="w-full text-left flex gap-3 border-t py-2 ${on ? "bg-blue-50" : "active:bg-slate-50"}">
      <i class="fa-${on ? "solid fa-square-check text-blue-700" : "regular fa-square text-slate-400"} text-2xl pt-1"></i>
      <div class="flex-1 min-w-0">${palletSummary(p)}</div>
    </button>`;
  }).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-back class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="flex-1 font-semibold">${d.note ? `Delivery note ${esc(d.note.note_no)}` : "New delivery note"}</div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div class="flex gap-2">
        ${label("Note no", input("no", `inputmode="numeric" maxlength="6" placeholder="1335"`), "w-24 shrink-0")}
        ${label("Transporter", select("transporter", transporterChoices(d), d.transporter_id, "Transporter...", (r) => r.name), "flex-1 min-w-0")}
      </div>
      ${label("Receiver", select("receiver", receiverChoices(d), d.receiver_id, "Receiver...", (r) => (r.text || receiverText(r)).split("\n").join(" · ")))}
      <div class="flex gap-2">
        ${label("Seal no", input("seal_no"), "flex-1 min-w-0")}
        ${label("Cooled to (°C)", input("cooled_to", `inputmode="decimal" maxlength="5"`), "w-28 shrink-0")}
      </div>
      <div class="flex gap-2">
        ${label("Loaded", input("loaded_on", `type="date"`), "flex-1 min-w-0")}
        ${label("Offloaded", input("offloaded_on", `type="date"`), "flex-1 min-w-0")}
      </div>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Pallets on the truck</div>
        <div id="noteTotals" class="text-base">${noteTotals(picked)}</div>
        <div class="text-xs text-white/80">Tick the pallets from Pallet Stack that go on this truck.</div>
      </div>
      ${pallets || `<div class="text-center text-slate-400 text-sm py-6 border-t">No pallets left to send</div>`}
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div id="noteMsg" class="text-sm text-red-600 empty:hidden">${d.note && d.note.error ? `Not saved: ${esc(d.note.error)}.` : ""}</div>
      <button type="button" data-savenote class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save delivery note</button>
      ${d.note ? `<button type="button" data-pdf class="w-full border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid fa-share-from-square"></i> Print or share</button>
                  <button type="button" data-removenote class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Delete delivery note</button>` : ""}
    </div>`;
}

async function saveNote() {
  const d = dn.draft;
  const fail = (m) => { $("noteMsg").textContent = m; };
  const no = Number(d.no);
  const receiver = receiverChoices(d).find((r) => r.id === d.receiver_id);
  const transporter = transporterChoices(d).find((t) => t.id === d.transporter_id);
  const pallets = palletChoices(d).filter((p) => d.picked.includes(p.uuid));
  if (!(no >= 1)) return fail("Type the note number.");
  const twin = Store.notes().find((n) => n.note_no === no && n.uuid !== d.uuid);
  if (twin) return fail(`Note ${no} is already used.`);
  if (!receiver) return fail("Pick the receiver.");
  if (!transporter) return fail("Pick the transporter.");
  if (!d.loaded_on) return fail("Pick the loading date.");
  if (!pallets.length) return fail("Tick the pallets on the truck.");
  const op = Operator.current() || {};
  const base = d.note || { kind: "delivery_note", created_at: new Date(Store.now()).toISOString(),
                           made_by: op.id || "", made_by_name: op.name || "" };
  await Store.saveRun({ ...base, kind: "delivery_note", uuid: d.uuid, note_no: no,
                        receiver_id: receiver.id, receiver: receiver.text || receiverText(receiver),
                        transporter_id: transporter.id, transporter: transporter.name,
                        seal_no: d.seal_no.trim(), cooled_to: d.cooled_to.trim(),
                        loaded_on: d.loaded_on, offloaded_on: d.offloaded_on, pallets,
                        changed_by: op.id || "", changed_by_name: op.name || "", removed: false, rev: Date.now() });
  // Stay on the note, now saved, so it can be printed or shared at once.
  openNote(Store.notes().find((n) => n.uuid === d.uuid));
}

async function removeNote() {
  if (!confirm(`Delete delivery note ${dn.draft.note.note_no}?`)) return;
  const op = Operator.current() || {};
  await Store.saveRun({ ...dn.draft.note, kind: "delivery_note", removed: true, changed_by: op.id || "",
                        changed_by_name: op.name || "", rev: Date.now() });
  dn.view = "list";
  renderDeliveryNote();
}

// The server makes the PDF, so the note must have reached it: a copy still
// in the outbox would print as it was before.
async function shareNote() {
  const n = Store.notes().find((x) => x.uuid === dn.draft.uuid);
  const msg = $("noteMsg");
  if (!n || n.synced === 0) { msg.textContent = "Still sending this note - try again when the pill says synced."; Store.syncNow(); return; }
  msg.textContent = "";
  try {
    const blob = await Boord.api(`/api/deliverynote/${encodeURIComponent(n.uuid)}/pdf`);
    const name = `afleweringsnota_${n.note_no}.pdf`;
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `Delivery note ${n.note_no}` });
    else Boord.downloadBlob(blob, name);
  } catch (e) {
    if (e.name === "AbortError") return; // closed the share sheet
    msg.textContent = Boord.errorDetail(e, "No connection to the server - the PDF needs it.");
  }
}

function onDeliveryClick(ev) {
  const t = ev.target.closest("button");
  if (!t) return;
  Operator.touch();
  const d = dn.draft;
  if (t.dataset.note) openNote(Store.notes().find((n) => n.uuid === t.dataset.note));
  else if ("addnote" in t.dataset) openNote(null);
  else if ("back" in t.dataset) { dn.view = "list"; renderDeliveryNote(); }
  else if (t.dataset.pick) {
    const u = t.dataset.pick;
    d.picked = d.picked.includes(u) ? d.picked.filter((x) => x !== u) : [...d.picked, u];
    const y = window.scrollY;
    renderDeliveryNote();
    window.scrollTo(0, y); // ticking a pallet far down the list must not jump to the top
  }
  else if ("savenote" in t.dataset) saveNote();
  else if ("pdf" in t.dataset) shareNote();
  else if ("removenote" in t.dataset) removeNote();
}

function onDeliveryInput(ev) {
  const f = ev.target.dataset.field;
  if (!f) return;
  Operator.touch();
  const v = ev.target.value;
  if (f === "receiver" || f === "transporter") dn.draft[`${f}_id`] = v ? Number(v) : null;
  else if (f === "no") { dn.draft.no = v.replace(/\D/g, ""); ev.target.value = dn.draft.no; }
  else dn.draft[f] = v;
}

// ---- Settings -> Delivery Note ----------------------------------------------

// One compact row a transporter or receiver: name (a receiver's market and
// city beneath), In use, delete, save. The packs' rows (consignment.js), one
// field more.
function dnSettingsRow(kind, row) {
  const isNew = row.id == null;
  const box = "border border-slate-300 rounded-lg px-2 py-2";
  const extra = kind === "receivers" ? `
      <div class="flex gap-1.5 mt-1.5">
        <input name="market" value="${esc(row.market)}" placeholder="Market" class="flex-1 min-w-0 ${box}">
        <input name="city" value="${esc(row.city)}" placeholder="City" class="flex-1 min-w-0 ${box}">
      </div>` : "";
  return `
    <form class="py-2" data-dn-form="${kind}" data-id="${isNew ? "new" : row.id}">
      <div class="flex items-center gap-1.5">
        <input name="name" value="${esc(row.name)}" placeholder="${isNew ? (kind === "receivers" ? "New receiver" : "New transporter") : ""}" class="flex-1 min-w-0 font-semibold ${box}">
        ${isNew ? `<span class="w-10 shrink-0"></span><span class="w-10 shrink-0"></span>`
          : `<label class="w-10 shrink-0 flex justify-center" title="In use"><input name="active" type="checkbox"${row.active ? " checked" : ""} class="w-5 h-5"></label>
             <button type="button" data-dn-delete title="Delete" class="w-10 h-10 shrink-0 rounded-lg border border-red-300 text-red-700"><i class="fa-solid fa-trash-can"></i></button>`}
        <button class="w-14 shrink-0 h-10 ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg font-semibold">${isNew ? "Add" : "Save"}</button>
      </div>${extra}
    </form>`;
}

function dnSettingsCard(kind, rows) {
  const head = `<div class="flex gap-1.5 pt-3 text-xs text-slate-500"><span class="flex-1">${kind === "receivers" ? "Receiver, then its market and city" : "Transporter"}</span>`
    + `<span class="w-10 shrink-0 text-center">In use</span><span class="w-10 shrink-0"></span><span class="w-14 shrink-0"></span></div>`;
  return `<div class="bg-white rounded-2xl shadow px-3 pb-1 divide-y divide-slate-100">${head}`
    + rows.map((r) => dnSettingsRow(kind, r)).join("") + dnSettingsRow(kind, { id: null, name: "", market: "", city: "" }) + `</div>`;
}

async function loadDeliverySettings() {
  try {
    const [transporters, receivers, opts] = await Promise.all([Boord.api("/api/settings/transporters"),
      Boord.api("/api/settings/receivers"), Boord.api("/api/deliverynote/options")]);
    $("transporterSettings").innerHTML = dnSettingsCard("transporters", transporters);
    $("receiverSettings").innerHTML = dnSettingsCard("receivers", receivers);
    $("dnCooledTo").value = opts.cooled_to;
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("transporterSettings").innerHTML = $("receiverSettings").innerHTML = `<div class="text-sm text-slate-500">These can only be changed while the server can be reached.</div>`;
  }
}

async function dnSettingsCall(path, opts, done) {
  try {
    await Boord.api(path, opts);
    Boord.toast(done);
    await loadDeliverySettings();
    Store.syncNow(); // the phones pick the change up
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

function saveDeliverySetting(ev) {
  ev.preventDefault();
  if (ev.target.id === "dnSettingsForm") {
    dnSettingsCall("/api/settings/deliverynote", { method: "PUT", body: { cooled_to: Number($("dnCooledTo").value) } }, "Saved");
    return;
  }
  const form = ev.target.closest("[data-dn-form]");
  if (!form) return;
  const f = new FormData(form);
  const kind = form.dataset.dnForm;
  const isNew = form.dataset.id === "new";
  const body = { name: f.get("name"), active: isNew ? true : f.get("active") === "on" };
  if (kind === "receivers") Object.assign(body, { market: f.get("market"), city: f.get("city") });
  dnSettingsCall(`/api/settings/${kind}${isNew ? "" : `/${form.dataset.id}`}`, { method: isNew ? "POST" : "PUT", body }, isNew ? "Added" : "Saved");
}

function deleteDeliverySetting(ev) {
  const btn = ev.target.closest("[data-dn-delete]");
  if (!btn) return;
  const form = btn.closest("[data-dn-form]");
  if (!confirm(`Delete ${new FormData(form).get("name")}?`)) return;
  dnSettingsCall(`/api/settings/${form.dataset.dnForm}/${form.dataset.id}`, { method: "DELETE" }, "Deleted");
}

function initDeliveryNote() {
  const body = $("deliveryBody");
  body.addEventListener("click", onDeliveryClick);
  body.addEventListener("input", onDeliveryInput);
  body.addEventListener("change", onDeliveryInput);
  $("deliverySettings").addEventListener("submit", saveDeliverySetting);
  $("deliverySettings").addEventListener("click", deleteDeliverySetting);
  // A sync landing while a note is being filled in must not wipe the form.
  Store.onChange(() => { if (!$("deliverynote").classList.contains("hidden") && dn.view !== "note") renderDeliveryNote(); });
  setInterval(() => { if (!$("deliverynote").classList.contains("hidden") && !Operator.current()) show(); }, 30000);
}
