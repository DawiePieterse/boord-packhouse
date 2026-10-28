// The Juice role on a phone: the juice bins and crates, each weighed empty
// (its tare) and, later in the day, full, as the paper weigh sheet has them
// with the scale's two stickers. Full ones then go on a delivery note to the
// juice buyer (deliverynote.js), full - empty = net. Bins and crates are the
// same record (container "bin" or "crate"), numbered apart; "bin" in the code
// means either.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// juice_bin), editable like a pallet (consignment.js): saving again re-queues
// the whole record (rev). Opens with the badge scan or the PIN; a bin keeps
// who first weighed it and who last changed it. Uses Operator and
// renderOperatorBar from sulfur.js, $, esc from app.js, openNote and noteLabel
// from deliverynote.js, and sameDay, sum,
// kgText, nowIso, seasonOf, groupHead, groupRow and LIST_HEAD from consignment.js.

let jc = { view: "list", draft: null };

const binNet = (b) => (b.empty_kg != null && b.full_kg != null ? b.full_kg - b.empty_kg : null);
const binFull = (b) => binNet(b) != null;
const binsNewestFirst = () => Store.bins().sort((a, b) => (a.weighed_at < b.weighed_at ? 1 : -1));
const containerOf = (b) => b.container || "bin"; // a copy made before crates is a bin
const CONTAINER_NAME = { bin: "Bin", crate: "Crate" };
const binName = (b) => `${CONTAINER_NAME[containerOf(b)]} ${b.bin_no}`;
// A new crate starts at this empty weight; a bin is weighed.
const CRATE_EMPTY_KG = "2";
const seasonBins = (season, container) => Store.bins().filter((b) => seasonOf(b.weighed_at) === season && containerOf(b) === container);
// The number runs on from the highest this season, as the weigh sheet does;
// bins and crates each count on their own.
function nextBinNo(container) {
  const used = seasonBins(seasonOf(nowIso()), container).map((b) => b.bin_no);
  return String((used.length ? Math.max(...used) : 0) + 1);
}
// The live delivery note a bin is on, if any.
const binNote = (uuid) => Store.notes().find((n) => (n.bins || []).some((b) => b.uuid === uuid));
// 2 bins · 1 crate: the containers there are (bins when none).
const containerCounts = (bins) => ["bin", "crate"].map((c) => [c, bins.filter((b) => containerOf(b) === c).length])
  .filter(([c, n]) => n || (c === "bin" && !bins.length)).map(([c, n]) => `<b>${n}</b> ${c}${n === 1 ? "" : "s"}`).join(" · ");
const binsTotal = (bins) => `${containerCounts(bins)} · <b>${kgText(sum(bins.filter(binFull), binNet))}</b> net`;

function renderJuice() {
  renderOperatorBar($("juiceOperatorBar"));
  $("juiceOperatorBar").classList.toggle("hidden", jc.view === "bin");
  $("juiceBody").innerHTML = jc.view === "bin" ? binForm() : binsView();
}

// One bin as the lists show it: its number, then full - empty = net, or the
// empty weight while it waits to be weighed full. The delivery note shows it too.
const binSummary = (b) => `
      <div class="flex justify-between gap-3 items-baseline">
        <div class="font-bold text-lg">${esc(binName(b))}</div>
        <div class="text-sm shrink-0">${binFull(b) ? `<b>${kgText(binNet(b))}</b>` : ""}</div>
      </div>
      <div class="text-sm">${binFull(b) ? `${kgText(b.full_kg)} full − ${kgText(b.empty_kg)} empty`
        : b.empty_kg != null ? `${kgText(b.empty_kg)} empty · <span class="font-semibold text-amber-700">waiting for the full weight</span>`
        : `${kgText(b.full_kg)} full · <span class="font-semibold text-amber-700">waiting for the empty weight</span>`}</div>`;

// Today's bins and crates (this phone's day), and any still waiting for a
// weight or refused, whatever its day, so none is lost. Those still waiting
// for a weight come first; in each part bins, then crates, highest number first.
function binsView() {
  const bins = Store.bins().filter((b) => sameDay(b.weighed_at) || !binFull(b) || b.error)
    .sort((a, b) => binFull(a) - binFull(b) || (containerOf(a) === "crate") - (containerOf(b) === "crate") || b.bin_no - a.bin_no);
  const rows = bins.map((b) => {
    const note = binNote(b.uuid);
    return `
    <button type="button" data-bin="${esc(b.uuid)}" class="${binFull(b) ? groupRow("local", true) /* weighed empty and full: green */ : groupRow("juice")}">
      ${binSummary(b)}
      ${note ? `<div class="text-xs text-slate-500">On delivery note ${esc(noteLabel(note))}</div>` : ""}
      ${b.error ? `<div class="text-sm text-red-600 mt-1">Not saved: ${esc(b.error)}. Tap to fix it.</div>` : ""}
    </button>`;
  }).join("");
  return `
    <div class="bg-white rounded-2xl shadow p-4">
      <div class="grid grid-cols-2 gap-3">
        <button type="button" data-addbin="bin" class="boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-weight-scale"></i> New bin</button>
        <button type="button" data-addbin="crate" class="boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-box"></i> New crate</button>
      </div>
      <button type="button" data-juicenote class="w-full mt-3 border-2 border-[var(--boord-blue)] text-[var(--boord-blue)] rounded-xl py-4 text-lg font-bold"><i class="fa-solid fa-file-lines"></i> New Juice Delivery Note</button>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Bins and crates weighed today</div>
        <div class="text-base">${binsTotal(bins)}</div>
        <div class="text-xs text-white/80">Tap one to add its full weight, change or delete it.</div>
      </div>
      ${rows ||`<div class="text-center text-slate-400 text-sm py-6 border-t">No bins or crates yet today</div>`}
    </div>
    ${juiceNotesView()}`;
}

// The juice delivery notes (J-), as the Delivery Note screen lists them:
// today's, then the earlier ones this phone holds greyed. Tapping one opens
// it there, and leaving it comes back here.
function juiceNotesView() {
  const notes = Store.notes().filter(isJuiceNote);
  const today = (n) => sameDay(n.created_at) || n.error;
  return `
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Delivery Notes</div>
        <div class="text-xs text-white/80">Tap a note to edit, print or share it.</div>
      </div>
      ${notes.map((n) => noteRow(n, !today(n))).join("") || `<div class="text-center text-slate-400 text-sm py-6 border-t">No juice delivery notes yet</div>`}
    </div>`;
}

function openBin(bin, container = "bin") {
  jc.view = "bin";
  jc.draft = bin
    ? { uuid: bin.uuid, bin, container: containerOf(bin), no: String(bin.bin_no),
        empty: bin.empty_kg == null ? "" : String(bin.empty_kg), full: bin.full_kg == null ? "" : String(bin.full_kg) }
    : { uuid: Boord.uuid(), bin: null, container, no: nextBinNo(container), empty: container === "crate" ? CRATE_EMPTY_KG : "", full: "" };
  renderJuice();
}

// A weight as typed: 37 or 37,5; blank is not weighed yet.
const kgOf = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(",", ".")));

function draftNetText(d) {
  const empty = kgOf(d.empty);
  const full = kgOf(d.full);
  return empty != null && full != null && full > empty ? `Net <b>${kgText(full - empty)}</b>` : "";
}

function binForm() {
  const d = jc.draft;
  const name = CONTAINER_NAME[d.container];
  const crate = d.container === "crate";
  const field = "w-full border border-slate-300 rounded-lg px-2 py-3 text-xl";
  const label = (text, html, cls) => `<label class="${cls}"><span class="text-xs font-semibold text-slate-600">${text}</span>${html}</label>`;
  const input = (f, extra) => `<input data-field="${f}" value="${esc(d[f])}" ${extra} class="${field}">`;
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-back class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="flex-1"><div class="font-semibold">${d.bin ? esc(binName(d.bin)) : `New ${name.toLowerCase()}`}</div>
        <div id="binNet" class="text-sm">${draftNetText(d)}</div></div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      ${label(`${name} no`, input("no", `inputmode="numeric" maxlength="5" placeholder="${crate ? "1" : "88"}"`), "block w-28")}
      <div class="flex gap-2">
        ${label("Empty (kg)", input("empty", `inputmode="decimal" maxlength="6" placeholder="${crate ? "2" : "37"}"`), "flex-1 min-w-0")}
        ${label("Full (kg)", input("full", `inputmode="decimal" maxlength="6" placeholder="${crate ? "20" : "503"}"`), "flex-1 min-w-0")}
      </div>
      <div class="text-xs text-slate-500">Weigh it empty first and save; open it again when it is full to add the full weight.</div>
      <div id="binMsg" class="text-sm text-red-600 empty:hidden">${d.bin && d.bin.error ? `Not saved: ${esc(d.bin.error)}.` : ""}</div>
      <button type="button" data-savebin class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save ${name.toLowerCase()}</button>
      ${d.bin ? `<button type="button" data-removebin class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Delete ${name.toLowerCase()}</button>` : ""}
    </div>`;
}

async function saveBin() {
  const d = jc.draft;
  const fail = (m) => { $("binMsg").textContent = m; };
  const no = Number(d.no);
  const empty = kgOf(d.empty);
  const full = kgOf(d.full);
  const name = CONTAINER_NAME[d.container];
  if (!(no >= 1)) return fail(`Type the ${name.toLowerCase()} number.`);
  const season = d.bin ? seasonOf(d.bin.weighed_at) : seasonOf(nowIso());
  if (seasonBins(season, d.container).some((b) => b.bin_no === no && b.uuid !== d.uuid)) return fail(`${name} ${no} is already used this season.`);
  if (empty == null && full == null) return fail("Type the empty weight, or the full weight.");
  if ([empty, full].some((kg) => kg != null && !(kg > 0 && kg < 5000))) return fail("A weight is a number of kg, like 37.");
  if (empty != null && full != null && full <= empty) return fail("The full weight is more than the empty weight.");
  const note = d.bin && binNote(d.uuid);
  if (note && (empty == null || full == null)) return fail(`${binName(d.bin)} is on delivery note ${noteLabel(note)}: it needs both weights.`);
  const op = Operator.current() || {};
  const base = d.bin || { kind: "juice_bin", weighed_at: nowIso(), made_by: op.id || "", made_by_name: op.name || "" };
  await Store.saveRun({ ...base, kind: "juice_bin", uuid: d.uuid, container: d.container, bin_no: no, empty_kg: empty, full_kg: full,
                        changed_by: op.id || "", changed_by_name: op.name || "", removed: false, rev: Date.now() });
  jc.view = "list";
  renderJuice();
}

async function removeBin() {
  const d = jc.draft;
  const note = binNote(d.uuid);
  if (note) { $("binMsg").textContent = `${binName(d.bin)} is on delivery note ${noteLabel(note)}: take it off the note first.`; return; }
  if (!confirm(`Delete ${binName(d.bin).toLowerCase()}?`)) return;
  const op = Operator.current() || {};
  await Store.saveRun({ ...d.bin, kind: "juice_bin", removed: true, changed_by: op.id || "", changed_by_name: op.name || "", rev: Date.now() });
  jc.view = "list";
  renderJuice();
}

function onJuiceClick(ev) {
  const t = ev.target.closest("button");
  if (!t) return;
  if (t.dataset.bin) openBin(Store.bins().find((b) => b.uuid === t.dataset.bin));
  else if (t.dataset.addbin) openBin(null, t.dataset.addbin);
  // A juice note, on the Delivery Note screen (deliverynote.js): only the full bins and crates to pick from.
  else if ("juicenote" in t.dataset) { dn.from = "juice"; openNote(null, true); location.hash = "#deliverynote"; }
  else if (t.dataset.note) { dn.from = "juice"; openNote(Store.notes().find((n) => n.uuid === t.dataset.note)); location.hash = "#deliverynote"; }
  else if ("back" in t.dataset) { jc.view = "list"; renderJuice(); }
  else if ("savebin" in t.dataset) saveBin();
  else if ("removebin" in t.dataset) removeBin();
}

function onJuiceInput(ev) {
  const f = ev.target.dataset.field;
  if (!f) return;
  const v = f === "no" ? ev.target.value.replace(/\D/g, "") : ev.target.value.replace(/[^\d.,]/g, "");
  ev.target.value = v;
  jc.draft[f] = v;
  $("binNet").innerHTML = draftNetText(jc.draft);
}

function initJuice() {
  const body = $("juiceBody");
  body.addEventListener("click", onJuiceClick);
  body.addEventListener("input", onJuiceInput);
  // A sync landing while a bin is being typed in must not wipe the form.
  Store.onChange(() => { if (!$("juice").classList.contains("hidden") && jc.view !== "bin") renderJuice(); });
  setInterval(() => { if (!$("juice").classList.contains("hidden") && !Operator.current()) show(); }, 30000);
}
