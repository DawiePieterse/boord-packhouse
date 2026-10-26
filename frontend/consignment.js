// The Pallet Stack role (the paper consignment sheet) on a phone: one screen
// of pallets. Each pallet is the code scanned off its label, its supplier and
// market, and what is on it: one or more lines of pack, cartons and block.
// Settings -> Pallet Stack sets the packs (with their real carton weight) and
// the markets.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// consignment / pallet), the sulfur technique (sulfur.js), but pallets stay
// editable: saving again re-queues the whole record (rev). A stack only
// groups pallets and has no screen of its own yet: a new pallet goes on the
// newest one, made the first time. Opens with the badge scan, like the sulfur
// screen: a pallet keeps who scanned it in and who last changed it. Uses
// Operator and renderOperatorBar from sulfur.js, $, esc from app.js and
// Html5Qrcode from shared/vendor.

let cn = { view: "list", draft: null };
let palletScanner = null;

// The pallet number is typed once and then runs on: 001, 002... (or from 100).
// Unique for the season (the calendar year it was scanned in) across every stack.
const seasonOf = (iso) => new Date(iso).getFullYear();
const seasonPallets = (season) => Store.pallets().filter((p) => seasonOf(p.scanned_at) === season);
function nextRef() {
  const used = seasonPallets(seasonOf(nowIso())).map((p) => Number(p.pallet_ref)).filter((n) => n >= 1);
  return String(Math.min(999, (used.length ? Math.max(...used) : 0) + 1)).padStart(3, "0");
}
const nowIso = () => new Date(Store.now()).toISOString();
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const palletCartons = (p) => sum(p.lines, (l) => l.cartons);
const palletKg = (p) => sum(p.lines, (l) => l.cartons * l.carton_kg);
const kgText = (kg) => `${kg.toLocaleString("en-ZA", { maximumFractionDigits: 1 })} kg`;
const newestFirst = () => Store.pallets().sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));

function renderConsignment() {
  if (cn.view !== "pallet") stopPalletScan();
  renderOperatorBar($("consignmentOperatorBar"));
  $("consignmentOperatorBar").classList.toggle("hidden", cn.view === "pallet"); // the form needs the room
  $("consignmentBody").innerHTML = cn.view === "pallet" ? palletForm() : palletsView();
}

// Today's pallets (this phone's day), and any refused one whatever its day, so it is never lost.
const sameDay = (iso) => new Date(iso).toDateString() === new Date(Store.now()).toDateString();

function palletsView() {
  const pallets = newestFirst().filter((p) => sameDay(p.scanned_at) || p.error);
  const rows = pallets.map((p) => `
    <button type="button" data-pallet="${esc(p.uuid)}" class="w-full text-left border-t py-2 active:bg-slate-50">
      ${palletSummary(p)}
      ${p.error ? `<div class="text-sm text-red-600 mt-1">Not saved: ${esc(p.error)}. Tap to fix it.</div>` : ""}
    </button>`).join("");
  return `
    <div class="bg-white rounded-2xl shadow p-4">
      <button type="button" data-add class="w-full boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-barcode"></i> Add a new pallet</button>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="font-semibold pt-3">Pallets added today</div>
      <div class="text-sm"><b>${pallets.length}</b> pallet${pallets.length === 1 ? "" : "s"} · <b>${sum(pallets, palletCartons)}</b> cartons · <b>${kgText(sum(pallets, palletKg))}</b></div>
      <div class="text-xs text-slate-500 pb-2">Tap a pallet to edit or delete it.</div>
      ${rows || `<div class="text-center text-slate-400 text-sm py-6 border-t">No pallets yet today</div>`}
    </div>`;
}

// One pallet as the list shows it: number, cartons and kg, date code, supplier,
// market, barcode and its lines. The delivery note shows pallets the same way.
const palletSummary = (p) => `
      <div class="flex justify-between gap-3 items-baseline">
        <div class="font-bold text-lg">Pallet ${esc(p.pallet_ref || "---")}</div>
        <div class="text-sm shrink-0"><b>${palletCartons(p)}</b> cartons · ${kgText(palletKg(p))}</div>
      </div>
      <div class="text-sm">${esc(palletDateCode(p))} · ${esc(p.supplier_name || "-")} · ${esc(p.market_name || "-")}</div>
      <div class="text-xs text-slate-500 truncate">Barcode ${esc(p.barcode)}${p.scanned_by_name ? ` · ${esc(p.scanned_by_name)}` : ""}</div>
      <ol class="list-decimal pl-6 mt-1 text-sm">
        ${p.lines.map((l) => `<li><b>${l.cartons}</b> x ${esc(l.packaging_name)}${l.block_id ? `, ${esc(l.block_name)}${l.variety ? `, ${esc(l.variety)}` : ""}` : ""}, Litchis</li>`).join("")}
      </ol>`;

// ---- A pallet: scan its label, then what is on it ---------------------------

// What this phone last saved (supplier, market, carton type, block): a new
// pallet starts from it. Only a convenience, so a missing copy is no harm.
const LAST_USED = "ph_pallet_last";
function lastUsed() {
  try { return JSON.parse(localStorage.getItem(LAST_USED)) || {}; } catch (_) { return {}; }
}
function rememberUsed(d, lines) {
  const l = lines[lines.length - 1];
  try {
    localStorage.setItem(LAST_USED, JSON.stringify({ supplier_id: d.supplier_id, market_id: d.market_id,
                                                     packaging_id: l.packaging_id, block_id: l.block_id || "" }));
  } catch (_) { /* private mode */ }
}
// A remembered id only if it is still on offer: a retired carton or market is not picked for you.
const stillOffered = (list, id) => (list.some((r) => r.id === id) ? id : null);

function openPallet(pallet) {
  cn.view = "pallet";
  if (pallet) {
    cn.draft = { uuid: pallet.uuid, pallet, barcode: pallet.barcode, ref: pallet.pallet_ref || "",
                 supplier_id: pallet.supplier_id, market_id: pallet.market_id,
                 lines: pallet.lines.map((l) => ({ packaging_id: l.packaging_id, cartons: l.cartons, block_id: l.block_id || "" })) };
  } else {
    // The values this phone last used, else those of the newest pallet.
    const newest = newestFirst()[0] || {};
    const line = (newest.lines || []).slice(-1)[0] || {};
    const last = { supplier_id: newest.supplier_id, market_id: newest.market_id, packaging_id: line.packaging_id,
                   block_id: line.block_id, ...lastUsed() };
    cn.draft = { uuid: Boord.uuid(), pallet: null, barcode: "", ref: nextRef(),
                 supplier_id: stillOffered(Store.suppliers(), last.supplier_id), market_id: stillOffered(Store.markets(), last.market_id),
                 lines: [{ packaging_id: stillOffered(Store.packaging(), last.packaging_id), cartons: "", block_id: last.block_id || "" }] };
  }
  renderConsignment();
  if (!pallet) startPalletScan();
}

// The active list plus the pallet's own copy if it has since been retired
// (or, for a supplier, dropped from Boord), so editing an old pallet loses nothing.
function withOwn(list, own) {
  return own && own.id != null && !list.some((r) => r.id === own.id) ? [own, ...list] : list;
}
const supplierChoices = (d) => withOwn(Store.suppliers(), d.pallet && { id: d.pallet.supplier_id, name: d.pallet.supplier_name });
const marketChoices = (d) => withOwn(Store.markets(), d.pallet && { id: d.pallet.market_id, name: d.pallet.market_name });

function packChoices(d) {
  const packs = Store.packaging().slice();
  for (const l of d.pallet ? d.pallet.lines : []) {
    if (!packs.some((p) => p.id === l.packaging_id)) packs.push({ id: l.packaging_id, name: l.packaging_name, carton_kg: l.carton_kg });
  }
  return packs;
}

// The blocks in the fruit received today and the last earlier receiving day
// (the sulfur screen's list, Store.sources()), plus the pallet's own blocks
// that have since dropped off it. Bought-in fruit has no block: it is the
// pallet's supplier.
function blockGroups(d) {
  const groups = Store.sources().map((g) => ({ label: g.label, blocks: g.sources.filter((s) => s.block_id != null) }))
    .filter((g) => g.blocks.length);
  const listed = (id) => groups.some((g) => g.blocks.some((b) => b.block_id === id));
  const earlier = (d.pallet ? d.pallet.lines : []).filter((l) => l.block_id && !listed(l.block_id))
    .map((l) => ({ block_id: l.block_id, block_name: l.block_name, variety: l.variety }));
  if (earlier.length) groups.push({ label: "Earlier", blocks: earlier });
  return groups;
}
const blockText = (b) => `${b.block_name}${b.variety ? ` · ${b.variety}` : ""}`;
const palletDateCode = (p) => (p && p.date_code) || dateCode(new Date(p ? p.scanned_at : nowIso()));

function draftLines(d) {
  const packs = packChoices(d);
  const blocks = blockGroups(d).flatMap((g) => g.blocks);
  const old = d.pallet ? d.pallet.lines : [];
  return d.lines.filter((l) => l.packaging_id != null && Number(l.cartons) >= 1).map((l) => {
    const pack = packs.find((p) => p.id === l.packaging_id);
    const block = blocks.find((b) => b.block_id === l.block_id);
    // An unchanged pack keeps the weight it was saved with.
    const prev = old.find((o) => o.packaging_id === l.packaging_id);
    return { packaging_id: pack.id, packaging_name: pack.name, carton_kg: prev ? prev.carton_kg : pack.carton_kg,
             cartons: Math.round(Number(l.cartons)), block_id: block ? block.block_id : null,
             block_name: block ? block.block_name : "", variety: block ? block.variety || "" : "" };
  });
}

const options = (rows, picked, blank) => `<option value="">${blank}</option>`
  + rows.map((r) => `<option value="${esc(r.id)}"${r.id === picked ? " selected" : ""}>${esc(r.name)}</option>`).join("");

function palletForm() {
  const d = cn.draft;
  const packs = packChoices(d);
  const groups = blockGroups(d);
  const field = "border border-slate-300 rounded-lg px-2 py-2.5";
  // One row a line: Qty, Carton type, Block, delete.
  const cell = "min-w-0 border border-slate-300 rounded-lg px-2 py-3";
  const lines = d.lines.map((l, i) => `
    <div class="flex gap-1.5 items-center" data-line="${i}">
      <span class="w-5 shrink-0 text-center text-sm text-slate-500">${i + 1}</span>
      <input data-field="cartons" inputmode="numeric" maxlength="4" placeholder="Qty" value="${esc(l.cartons)}" class="w-12 shrink-0 ${cell}">
      <select data-field="pack" class="flex-1 ${cell}">${options(packs, l.packaging_id, "Carton...")}</select>
      <select data-field="lineblock" class="flex-1 ${cell}">
        <option value="">Block...</option>
        ${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.blocks.map((b) => `<option value="${esc(b.block_id)}"${b.block_id === l.block_id ? " selected" : ""}>${esc(blockText(b))}</option>`).join("")}</optgroup>`).join("")}
      </select>
      <button type="button" data-drop="${i}" title="Delete this line" class="w-8 shrink-0 py-3 text-slate-400"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-cancel class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="flex-1"><div class="font-semibold">${d.pallet ? `Pallet ${esc(d.pallet.pallet_ref || "")}` : "New pallet"}</div>
        <div id="palletTotal" class="text-sm">${totalText(draftLines(d))}</div></div>
      <div class="font-semibold" title="Date code">${esc(palletDateCode(d.pallet))}</div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div id="palletReader" class="hidden w-full rounded-lg overflow-hidden bg-black min-h-[200px]"></div>
      <label class="block"><span class="text-xs font-semibold text-slate-600">Barcode</span>
        <span class="flex gap-2"><input data-field="barcode" value="${esc(d.barcode)}" inputmode="numeric" placeholder="Scan the pallet label" class="flex-1 min-w-0 ${field}">
        <button type="button" data-scan class="px-3 rounded-lg border border-slate-300"><i class="fa-solid fa-barcode text-xl"></i></button></span></label>
      <div class="flex gap-2">
        <label class="w-16 shrink-0"><span class="text-xs font-semibold text-slate-600">Pallet no</span>
          <input data-field="ref" value="${esc(d.ref)}" inputmode="numeric" maxlength="3" pattern="[0-9]{3}" placeholder="001" class="w-full ${field}"></label>
        <label class="flex-1 min-w-0"><span class="text-xs font-semibold text-slate-600">Supplier</span>
          <select data-field="supplier" class="w-full ${field}">${options(supplierChoices(d), d.supplier_id, "Supplier...")}</select></label>
        <label class="flex-1 min-w-0"><span class="text-xs font-semibold text-slate-600">Market</span>
          <select data-field="market" class="w-full ${field}">${options(marketChoices(d), d.market_id, "Market...")}</select></label>
      </div>
      <div id="palletScanMsg" class="text-sm text-red-600 empty:hidden">${d.pallet && d.pallet.error ? `Not saved: ${esc(d.pallet.error)}.` : ""}</div>
      <div class="text-sm font-semibold text-slate-600">What is on the pallet</div>
      <div class="flex gap-1.5 text-xs text-slate-500 -mb-2"><span class="w-5 shrink-0"></span><span class="w-12 shrink-0">Qty</span><span class="flex-1">Carton type</span><span class="flex-1">Block</span><span class="w-8 shrink-0"></span></div>
      ${lines}
      <button type="button" data-addline class="text-blue-700 font-semibold"><i class="fa-solid fa-plus"></i> Another line</button>
      <button type="button" data-save class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save pallet</button>
      ${d.pallet ? `<button type="button" data-remove class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Delete pallet</button>` : ""}
    </div>`;
}

const totalText = (lines) => `<b>${sum(lines, (l) => l.cartons)}</b> cartons · <b>${kgText(sum(lines, (l) => l.cartons * l.carton_kg))}</b>`;
function updatePalletTotal() {
  const el = $("palletTotal");
  if (el) el.innerHTML = totalText(draftLines(cn.draft));
}

// A browser only hands out the camera on https (or localhost): on the farm
// that is the Tailscale address, as for the badge scan (sulfur.js).
async function startPalletScan() {
  const msg = $("palletScanMsg");
  if (!window.isSecureContext) { msg.textContent = "Scanning needs the secure https://...ts.net:8060/ address - check Tailscale is connected, or type the code."; return; }
  if (palletScanner) return;
  msg.textContent = "";
  $("palletReader").classList.remove("hidden");
  const F = Html5QrcodeSupportedFormats;
  palletScanner = new Html5Qrcode("palletReader", { formatsToSupport: [F.CODE_128, F.CODE_39, F.ITF, F.EAN_13, F.QR_CODE], verbose: false });
  try {
    await palletScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 110 } }, onPalletCode, () => {});
  } catch (e) {
    palletScanner = null;
    $("palletReader").classList.add("hidden");
    msg.textContent = "Camera unavailable - allow camera access, then tap the barcode button, or type the code.";
  }
}

function stopPalletScan() {
  const s = palletScanner;
  palletScanner = null;
  const reader = document.getElementById("palletReader");
  if (reader) reader.classList.add("hidden");
  if (s) try { Promise.resolve(s.stop()).then(() => s.clear()).catch(() => {}); } catch (_) { /* never started */ }
}

// Another live pallet with this code, if any (the server checks it too).
const palletWithCode = (code, uuid) => Store.pallets().find((p) => p.barcode === code && p.uuid !== uuid);

function onPalletCode(text) {
  if (!palletScanner) return; // the camera reports a code many times a second
  const code = text.trim();
  const other = palletWithCode(code, cn.draft.uuid);
  if (other) {
    Boord._tone(220, 0.35);
    $("palletScanMsg").textContent = `That label is already on pallet ${other.pallet_ref}.`;
    return;
  }
  stopPalletScan();
  Boord.beepScanned();
  cn.draft.barcode = code;
  document.querySelector('#consignmentBody [data-field="barcode"]').value = code;
  $("palletScanMsg").textContent = "";
}

// The stack a new pallet goes on: the newest, or a new one the first time.
async function currentStack() {
  const newest = Store.consignments()[0];
  if (newest) return newest.uuid;
  const uuid = Boord.uuid();
  await Store.saveRun({ kind: "consignment", uuid, created_at: nowIso(), rev: Date.now() });
  return uuid;
}

async function savePallet() {
  const d = cn.draft;
  const lines = draftLines(d);
  const barcode = d.barcode.trim();
  const supplier = supplierChoices(d).find((s) => s.id === d.supplier_id);
  const market = marketChoices(d).find((m) => m.id === d.market_id);
  const fail = (m) => { $("palletScanMsg").textContent = m; };
  if (!/^\d{3}$/.test(d.ref)) return fail("The pallet number is 3 digits, like 001.");
  if (!supplier) return fail("Pick the supplier.");
  if (!market) return fail("Pick the market.");
  if (!barcode) return fail("Scan the pallet label first.");
  const twin = seasonPallets(d.pallet ? seasonOf(d.pallet.scanned_at) : seasonOf(nowIso())).find((p) => p.pallet_ref === d.ref && p.uuid !== d.uuid);
  if (twin) return fail(`Pallet ${d.ref} is already used this season.`);
  if (!lines.length) return fail("Pick a carton type and the number of cartons.");
  // A line with only one of the two is a slip, not a blank line to skip.
  if (d.lines.some((l) => (l.packaging_id != null) !== (Number(l.cartons) >= 1))) return fail("Every line needs a carton type and a number of cartons.");
  const other = palletWithCode(barcode, d.uuid);
  if (other) return fail(`That label is already on pallet ${other.pallet_ref}.`);
  stopPalletScan();
  const op = Operator.current() || {};
  const base = d.pallet || { kind: "pallet", consignment_uuid: await currentStack(), scanned_at: nowIso(),
                             scanned_by: op.id || "", scanned_by_name: op.name || "" };
  await Store.saveRun({ ...base, kind: "pallet", uuid: d.uuid, barcode, lines, pallet_ref: d.ref,
                        changed_by: op.id || "", changed_by_name: op.name || "",
                        supplier_id: supplier.id, supplier_name: supplier.name, market_id: market.id, market_name: market.name,
                        date_code: palletDateCode(d.pallet), removed: false, rev: Date.now() });
  rememberUsed(d, lines);
  cn.view = "list";
  renderConsignment();
}

async function removePallet() {
  const d = cn.draft;
  if (!confirm("Delete this pallet?")) return;
  const op = Operator.current() || {};
  await Store.saveRun({ ...d.pallet, kind: "pallet", removed: true, changed_by: op.id || "", changed_by_name: op.name || "", rev: Date.now() });
  cn.view = "list";
  renderConsignment();
}

function onConsignmentClick(ev) {
  const t = ev.target.closest("button");
  if (!t) return;
  Operator.touch(); // working here keeps the operator signed in
  const d = cn.draft;
  const sync = () => { cn.draft.lines = cn.draft.lines.slice(); renderConsignment(); };
  if (t.dataset.pallet) openPallet(Store.pallets().find((p) => p.uuid === t.dataset.pallet));
  else if ("add" in t.dataset) openPallet(null);
  else if ("cancel" in t.dataset) { cn.view = "list"; renderConsignment(); }
  else if ("scan" in t.dataset) startPalletScan();
  else if ("addline" in t.dataset) {
    // A new line starts with the carton type and block of the one above.
    const above = d.lines[d.lines.length - 1] || {};
    d.lines.push({ packaging_id: above.packaging_id == null ? null : above.packaging_id, cartons: "", block_id: above.block_id || "" });
    sync();
  }
  else if (t.dataset.drop) {
    const i = Number(t.dataset.drop);
    const l = d.lines[i];
    // Ask first, unless no Qty was typed (a new line's carton type and block are only copied from the line above).
    if (l.cartons !== "" && !confirm(`Delete line ${i + 1}?`)) return;
    d.lines.splice(i, 1);
    if (!d.lines.length) d.lines.push({ packaging_id: null, cartons: "", block_id: "" }); // a pallet is deleted with its own button
    sync();
  }
  else if ("save" in t.dataset) savePallet();
  else if ("remove" in t.dataset) removePallet();
}

function onConsignmentInput(ev) {
  const f = ev.target.dataset.field;
  const v = ev.target.value;
  if (!f) return;
  Operator.touch();
  if (f === "barcode") { cn.draft.barcode = v; return; }
  if (f === "ref") { cn.draft.ref = v.replace(/\D/g, "").slice(0, 3); ev.target.value = cn.draft.ref; return; }
  if (f === "supplier" || f === "market") { cn.draft[`${f}_id`] = v ? Number(v) : null; return; }
  const line = cn.draft.lines[Number(ev.target.closest("[data-line]").dataset.line)];
  if (f === "pack") line.packaging_id = v ? Number(v) : null;
  else if (f === "lineblock") line.block_id = v;
  // A text box, not type=number: its spinner hid the digits in a box this narrow.
  else { line.cartons = v.replace(/\D/g, ""); ev.target.value = line.cartons; }
  updatePalletTotal();
}

// ---- Settings -> Consignment ------------------------------------------------

// One compact row a carton or market: name, (kg), In use, delete, save. The
// column names are said once, above the rows.
function settingsRow(kind, row) {
  const isNew = row.id == null;
  const box = "border border-slate-300 rounded-lg px-2 py-2";
  return `
    <form class="flex items-center gap-1.5 py-2" data-cn-form="${kind}" data-id="${isNew ? "new" : row.id}">
      <input name="name" value="${esc(row.name)}" placeholder="${isNew ? (kind === "packaging" ? "New carton" : "New market") : ""}" class="flex-1 min-w-0 font-semibold ${box}">
      ${kind === "packaging" ? `<input name="carton_kg" type="number" step="any" inputmode="decimal" value="${esc(row.carton_kg)}" placeholder="kg" class="w-14 shrink-0 ${box}">` : ""}
      ${isNew ? `<span class="w-10 shrink-0"></span><span class="w-10 shrink-0"></span>`
        : `<label class="w-10 shrink-0 flex justify-center" title="In use"><input name="active" type="checkbox"${row.active ? " checked" : ""} class="w-5 h-5"></label>
           <button type="button" data-cn-delete title="Delete" class="w-10 h-10 shrink-0 rounded-lg border border-red-300 text-red-700"><i class="fa-solid fa-trash-can"></i></button>`}
      <button class="w-14 shrink-0 h-10 ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg font-semibold">${isNew ? "Add" : "Save"}</button>
    </form>`;
}

function settingsCard(kind, rows) {
  const head = `<div class="flex gap-1.5 pt-3 text-xs text-slate-500"><span class="flex-1">${kind === "packaging" ? "Carton" : "Market"}</span>`
    + `${kind === "packaging" ? `<span class="w-14 shrink-0">kg</span>` : ""}<span class="w-10 shrink-0 text-center">In use</span><span class="w-10 shrink-0"></span><span class="w-14 shrink-0"></span></div>`;
  return `<div class="bg-white rounded-2xl shadow px-3 pb-1 divide-y divide-slate-100">${head}`
    + rows.map((r) => settingsRow(kind, r)).join("") + settingsRow(kind, { id: null, name: "", carton_kg: "" }) + `</div>`;
}

async function loadConsignmentSettings() {
  try {
    const [packs, markets] = await Promise.all([Boord.api("/api/settings/packaging"), Boord.api("/api/settings/markets")]);
    $("packagingSettings").innerHTML = settingsCard("packaging", packs);
    $("marketSettings").innerHTML = settingsCard("markets", markets);
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("packagingSettings").innerHTML = $("marketSettings").innerHTML = `<div class="text-sm text-slate-500">These can only be changed while the server can be reached.</div>`;
  }
}

async function saveConsignmentSetting(ev) {
  const form = ev.target.closest("[data-cn-form]");
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form);
  const kind = form.dataset.cnForm;
  const isNew = form.dataset.id === "new";
  const body = { name: f.get("name"), active: isNew ? true : f.get("active") === "on" };
  if (kind === "packaging") body.carton_kg = Number(f.get("carton_kg"));
  try {
    await Boord.api(`/api/settings/${kind}${isNew ? "" : `/${form.dataset.id}`}`, { method: isNew ? "POST" : "PUT", body });
    Boord.toast(isNew ? "Added" : "Saved");
    await loadConsignmentSettings();
    Store.syncNow(); // the phones pick the change up
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

async function deleteConsignmentSetting(ev) {
  const btn = ev.target.closest("[data-cn-delete]");
  if (!btn) return;
  const form = btn.closest("[data-cn-form]");
  const name = new FormData(form).get("name");
  if (!confirm(`Delete ${name}?`)) return;
  try {
    await Boord.api(`/api/settings/${form.dataset.cnForm}/${form.dataset.id}`, { method: "DELETE" });
    Boord.toast("Deleted");
    await loadConsignmentSettings();
    Store.syncNow();
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

function initConsignment() {
  const body = $("consignmentBody");
  body.addEventListener("click", onConsignmentClick);
  body.addEventListener("input", onConsignmentInput);
  body.addEventListener("change", onConsignmentInput);
  $("consignmentSettings").addEventListener("submit", saveConsignmentSetting);
  $("consignmentSettings").addEventListener("click", deleteConsignmentSetting);
  // A sync landing while a pallet is being filled in must not wipe the form.
  Store.onChange(() => { if (!$("palletstack").classList.contains("hidden") && cn.view !== "pallet") renderConsignment(); });
  // The operator went idle while this screen was open: back to the badge.
  setInterval(() => { if (!$("palletstack").classList.contains("hidden") && !Operator.current()) show(); }, 30000);
}
