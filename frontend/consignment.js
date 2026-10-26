// The Consignment role: the paper consignment sheet on a phone. A consignment
// is a market and its pallets; each pallet is the code scanned off its label
// plus what is on it (one or more packs and a carton count each). Settings ->
// Consignment sets the packs (with their real carton weight) and the markets.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// consignment / pallet), the sulfur technique (sulfur.js), but both stay
// editable: saving again re-queues the whole record (rev). The pallet's own
// number (0001 each year) is given by the server the first time it arrives,
// so a pallet saved with no signal shows "..." until then. Uses $, esc from
// app.js and Html5Qrcode from shared/vendor.

let cn = { view: "list", consignment: null, draft: null };
let palletScanner = null;

const pad = (n) => (n == null ? "..." : String(n).padStart(4, "0"));
const nowIso = () => new Date(Store.now()).toISOString();
const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const palletCartons = (p) => sum(p.lines, (l) => l.cartons);
const palletKg = (p) => sum(p.lines, (l) => l.cartons * l.carton_kg);
const kgText = (kg) => `${kg.toLocaleString("en-ZA", { maximumFractionDigits: 1 })} kg`;
const dayText = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

function palletsOf(c) { return Store.pallets().filter((p) => p.consignment_uuid === c.uuid).sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : 1)); }

function renderConsignment() {
  if (cn.view !== "pallet") stopPalletScan();
  const body = $("consignmentBody");
  if (cn.view === "pallet") { body.innerHTML = palletForm(); return; }
  const c = cn.view === "detail" ? Store.consignments().find((x) => x.uuid === cn.consignment) : null;
  if (cn.view === "detail" && !c) cn.view = "list";
  body.innerHTML = c ? detailView(c) : listView();
}

function listView() {
  const markets = Store.markets();
  const rows = Store.consignments().map((c) => {
    const pallets = palletsOf(c);
    return `<button type="button" data-open="${esc(c.uuid)}" class="w-full bg-white rounded-2xl shadow p-4 text-left flex items-center justify-between gap-3 active:bg-slate-50">
      <div><div class="font-bold">${esc(c.market_name)}</div><div class="text-sm text-slate-500">${esc(c.supplier_name ? `${c.supplier_name} · ` : "")}${esc(dayText(c.created_at))}</div></div>
      <div class="text-right text-sm"><div class="font-semibold">${pallets.length} pallet${pallets.length === 1 ? "" : "s"}</div>
        <div class="text-slate-500">${sum(pallets, palletCartons)} cartons · ${kgText(sum(pallets, palletKg))}</div></div>
    </button>`;
  }).join("");
  return `
    <form data-new class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div class="font-semibold">New consignment</div>
      <select name="supplier" class="w-full border border-slate-300 rounded-lg p-3 text-lg">
        ${Store.suppliers().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}
      </select>
      <select name="market" class="w-full border border-slate-300 rounded-lg p-3 text-lg">
        ${markets.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}
      </select>
      <button class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold"${markets.length && Store.suppliers().length ? "" : " disabled"}>Start consignment</button>
      ${markets.length ? "" : `<div class="text-sm text-slate-500">No markets yet - add them in Settings -> Consignment.</div>`}
      ${Store.suppliers().length ? "" : `<div class="text-sm text-slate-500">No suppliers yet - the list comes from Boord, so connect once to load it.</div>`}
    </form>
    ${rows || `<div class="text-center text-slate-400 text-sm py-6">No consignments yet</div>`}`;
}

function detailView(c) {
  const pallets = palletsOf(c);
  const markets = Store.markets();
  const options = markets.some((m) => m.id === c.market_id) ? markets : [{ id: c.market_id, name: c.market_name }, ...markets];
  const suppliers = Store.suppliers();
  // A consignment made before suppliers existed has none: show it blank, never as the first one.
  const supplierOptions = c.supplier_id == null ? [{ id: "", name: "Supplier..." }, ...suppliers]
    : suppliers.some((s) => s.id === c.supplier_id) ? suppliers : [{ id: c.supplier_id, name: c.supplier_name }, ...suppliers];
  const rows = pallets.map((p) => `
    <button type="button" data-pallet="${esc(p.uuid)}" class="w-full text-left border-t py-3 flex gap-3 items-start active:bg-slate-50">
      <div class="font-bold text-lg w-14 shrink-0">${pad(p.pallet_no)}</div>
      <div class="flex-1 min-w-0">
        ${p.lines.map((l) => `<div class="text-sm">${esc(l.packaging_name)} <b>${l.cartons}</b></div>`).join("")}
        <div class="text-xs text-slate-400 truncate">${esc(p.barcode)}</div>
      </div>
      <div class="text-right text-sm shrink-0"><div class="font-semibold">${palletCartons(p)}</div><div class="text-slate-500">${kgText(palletKg(p))}</div></div>
    </button>`).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-back class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="text-slate-500 text-sm">${esc(dayText(c.created_at))}</div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <select data-supplier class="w-full border border-slate-300 rounded-lg p-3 text-lg font-semibold">
        ${supplierOptions.map((s) => `<option value="${s.id}"${s.id === c.supplier_id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}
      </select>
      <select data-market class="w-full border border-slate-300 rounded-lg p-3 text-lg font-semibold">
        ${options.map((m) => `<option value="${m.id}"${m.id === c.market_id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}
      </select>
      <div class="flex justify-between text-sm"><span>${pallets.length} pallet${pallets.length === 1 ? "" : "s"}</span>
        <span><b>${sum(pallets, palletCartons)}</b> cartons · <b>${kgText(sum(pallets, palletKg))}</b></span></div>
      <button type="button" data-add class="w-full boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-barcode"></i> Scan a pallet</button>
    </div>
    ${pallets.length ? `<div class="bg-white rounded-2xl shadow px-4 pb-1"><div class="text-xs text-slate-500 pt-3 pb-2">Pallet · what is on it · cartons / weight. Tap one to change it.</div>${rows}</div>` : ""}`;
}

// ---- A pallet: scan its label, then what is on it ---------------------------

function openPallet(pallet) {
  cn.view = "pallet";
  cn.draft = pallet
    ? { uuid: pallet.uuid, pallet, barcode: pallet.barcode, lines: pallet.lines.map((l) => ({ packaging_id: l.packaging_id, cartons: l.cartons })) }
    : { uuid: Boord.uuid(), pallet: null, barcode: "", lines: [{ packaging_id: null, cartons: "" }] };
  renderConsignment();
  if (!pallet) startPalletScan();
}

// A draft line's pack: the active list, plus the pallet's own copy if it was
// since retired, so editing an old pallet never loses a line.
function packChoices(d) {
  const packs = Store.packaging().slice();
  for (const l of d.pallet ? d.pallet.lines : []) {
    if (!packs.some((p) => p.id === l.packaging_id)) packs.push({ id: l.packaging_id, name: l.packaging_name, carton_kg: l.carton_kg });
  }
  return packs;
}

function draftLines(d) {
  const packs = packChoices(d);
  const old = d.pallet ? d.pallet.lines : [];
  return d.lines.filter((l) => l.packaging_id != null && Number(l.cartons) >= 1).map((l) => {
    const pack = packs.find((p) => p.id === l.packaging_id);
    // An unchanged line keeps the weight it was saved with.
    const prev = old.find((o) => o.packaging_id === l.packaging_id);
    return { packaging_id: pack.id, packaging_name: pack.name, carton_kg: prev ? prev.carton_kg : pack.carton_kg, cartons: Math.round(Number(l.cartons)) };
  });
}

function palletForm() {
  const d = cn.draft;
  const packs = packChoices(d);
  const lines = d.lines.map((l, i) => `
    <div class="flex gap-2 items-center" data-line="${i}">
      <select data-field="pack" class="flex-1 min-w-0 border border-slate-300 rounded-lg p-3 text-lg">
        <option value="">Pack...</option>
        ${packs.map((p) => `<option value="${p.id}"${p.id === l.packaging_id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
      </select>
      <input data-field="cartons" type="number" inputmode="numeric" min="1" step="1" placeholder="Cartons" value="${esc(l.cartons)}" class="w-28 border border-slate-300 rounded-lg p-3 text-lg">
      ${d.lines.length > 1 ? `<button type="button" data-drop="${i}" class="px-3 py-3 text-slate-400"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </div>`).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-cancel class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="font-semibold">${d.pallet ? `Pallet ${pad(d.pallet.pallet_no)}` : "New pallet"}</div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div id="palletReader" class="hidden w-full rounded-lg overflow-hidden bg-black min-h-[200px]"></div>
      <div class="flex gap-2">
        <input data-field="barcode" value="${esc(d.barcode)}" inputmode="numeric" placeholder="Scan the pallet label" class="flex-1 min-w-0 border border-slate-300 rounded-lg p-3 text-lg">
        <button type="button" data-scan class="px-4 rounded-lg border border-slate-300"><i class="fa-solid fa-barcode text-xl"></i></button>
      </div>
      <div id="palletScanMsg" class="text-sm text-red-600 empty:hidden"></div>
      <div class="text-sm font-semibold text-slate-600">What is on it</div>
      ${lines}
      <button type="button" data-addline class="text-blue-700 font-semibold"><i class="fa-solid fa-plus"></i> Another pack</button>
      <div id="palletTotal" class="text-sm bg-slate-50 rounded-lg p-3"></div>
      <button type="button" data-save class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save pallet</button>
      ${d.pallet ? `<button type="button" data-remove class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Take this pallet off</button>` : ""}
    </div>`;
}

function updatePalletTotal() {
  const lines = draftLines(cn.draft);
  const el = $("palletTotal");
  if (el) el.innerHTML = `<b>${sum(lines, (l) => l.cartons)}</b> cartons · <b>${kgText(sum(lines, (l) => l.cartons * l.carton_kg))}</b>`;
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
    $("palletScanMsg").textContent = `That label is already on pallet ${pad(other.pallet_no)}.`;
    return;
  }
  stopPalletScan();
  Boord.beepScanned();
  cn.draft.barcode = code;
  document.querySelector('#consignmentBody [data-field="barcode"]').value = code;
  $("palletScanMsg").textContent = "";
}

async function savePallet() {
  const d = cn.draft;
  const lines = draftLines(d);
  const barcode = d.barcode.trim();
  const fail = (m) => { $("palletScanMsg").textContent = m; };
  if (!barcode) return fail("Scan the pallet label first.");
  if (!lines.length) return fail("Pick a pack and the number of cartons.");
  // A line with only one of the two is a slip, not a blank line to skip.
  if (d.lines.some((l) => (l.packaging_id != null) !== (Number(l.cartons) >= 1))) return fail("Every line needs a pack and a number of cartons.");
  const other = palletWithCode(barcode, d.uuid);
  if (other) return fail(`That label is already on pallet ${pad(other.pallet_no)}.`);
  stopPalletScan();
  await Store.saveRun({ ...(d.pallet || { kind: "pallet", consignment_uuid: cn.consignment, scanned_at: nowIso() }),
                        kind: "pallet", uuid: d.uuid, barcode, lines, removed: false, rev: Date.now() });
  cn.view = "detail";
  renderConsignment();
}

async function removePallet() {
  const d = cn.draft;
  if (!confirm(`Take pallet ${pad(d.pallet.pallet_no)} off this consignment?`)) return;
  await Store.saveRun({ ...d.pallet, kind: "pallet", removed: true, rev: Date.now() });
  cn.view = "detail";
  renderConsignment();
}

async function startConsignment(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const market = Store.markets().find((m) => m.id === Number(f.get("market")));
  const supplier = Store.suppliers().find((s) => s.id === Number(f.get("supplier")));
  if (!market || !supplier) return;
  const uuid = Boord.uuid();
  await Store.saveRun({ kind: "consignment", uuid, market_id: market.id, market_name: market.name,
                        supplier_id: supplier.id, supplier_name: supplier.name, created_at: nowIso(), rev: Date.now() });
  cn = { view: "detail", consignment: uuid, draft: null };
  renderConsignment();
}

async function changeConsignment(c, change) {
  await Store.saveRun({ ...c, ...change, kind: "consignment", rev: Date.now() });
}

function onConsignmentClick(ev) {
  const t = ev.target.closest("button");
  if (!t) return;
  const d = cn.draft;
  const sync = () => { cn.draft.lines = cn.draft.lines.slice(); renderConsignment(); };
  if (t.dataset.open) { cn = { view: "detail", consignment: t.dataset.open, draft: null }; renderConsignment(); }
  else if (t.dataset.pallet) openPallet(Store.pallets().find((p) => p.uuid === t.dataset.pallet));
  else if ("back" in t.dataset) { cn = { view: "list", consignment: null, draft: null }; renderConsignment(); }
  else if ("add" in t.dataset) openPallet(null);
  else if ("cancel" in t.dataset) { cn.view = "detail"; renderConsignment(); }
  else if ("scan" in t.dataset) startPalletScan();
  else if ("addline" in t.dataset) { d.lines.push({ packaging_id: null, cartons: "" }); sync(); }
  else if (t.dataset.drop) { d.lines.splice(Number(t.dataset.drop), 1); sync(); }
  else if ("save" in t.dataset) savePallet();
  else if ("remove" in t.dataset) removePallet();
}

function onConsignmentInput(ev) {
  const f = ev.target.dataset.field;
  if (f === "barcode") { cn.draft.barcode = ev.target.value; return; }
  if (f) {
    const line = cn.draft.lines[Number(ev.target.closest("[data-line]").dataset.line)];
    if (f === "pack") line.packaging_id = ev.target.value ? Number(ev.target.value) : null;
    else line.cartons = ev.target.value;
    updatePalletTotal();
  } else if (ev.type === "change" && ev.target.matches("[data-market], [data-supplier]")) {
    const c = Store.consignments().find((x) => x.uuid === cn.consignment);
    const isMarket = ev.target.matches("[data-market]");
    const picked = (isMarket ? Store.markets() : Store.suppliers()).find((r) => r.id === Number(ev.target.value));
    if (c && picked) changeConsignment(c, isMarket ? { market_id: picked.id, market_name: picked.name } : { supplier_id: picked.id, supplier_name: picked.name });
  }
}

// ---- Settings -> Consignment ------------------------------------------------

function settingsRow(kind, row) {
  const isNew = row.id == null;
  return `
    <form class="bg-white rounded-2xl shadow p-4 space-y-3" data-cn-form="${kind}" data-id="${isNew ? "new" : row.id}">
      <div class="flex items-center gap-2">
        <input name="name" value="${esc(row.name)}" placeholder="${kind === "packaging" ? "Pack, e.g. 1kg XXL" : "Market"}" class="flex-1 min-w-0 border border-slate-300 rounded-lg p-2 text-lg font-semibold">
        ${kind === "packaging" ? `<label class="block w-28 shrink-0"><span class="text-xs text-slate-500">Carton kg</span>
          <input name="carton_kg" type="number" step="any" inputmode="decimal" value="${esc(row.carton_kg)}" class="w-full border border-slate-300 rounded-lg p-2"></label>` : ""}
      </div>
      <div class="flex items-center justify-between gap-3">
        ${isNew ? "<span></span>" : `<label class="text-sm flex items-center gap-2"><input name="active" type="checkbox"${row.active ? " checked" : ""} class="w-5 h-5"> In use</label>`}
        <button class="px-5 ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg py-2 font-semibold">${isNew ? "Add" : "Save"}</button>
      </div>
    </form>`;
}

async function loadConsignmentSettings() {
  try {
    const [packs, markets] = await Promise.all([Boord.api("/api/settings/packaging"), Boord.api("/api/settings/markets")]);
    $("packagingSettings").innerHTML = packs.map((p) => settingsRow("packaging", p)).join("")
      + `<div class="text-sm font-semibold text-slate-600 pt-2">Add a pack</div>` + settingsRow("packaging", { id: null, name: "", carton_kg: "" });
    $("marketSettings").innerHTML = markets.map((m) => settingsRow("markets", m)).join("")
      + `<div class="text-sm font-semibold text-slate-600 pt-2">Add a market</div>` + settingsRow("markets", { id: null, name: "" });
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

function initConsignment() {
  const body = $("consignmentBody");
  body.addEventListener("click", onConsignmentClick);
  body.addEventListener("input", onConsignmentInput);
  body.addEventListener("change", onConsignmentInput);
  body.addEventListener("submit", (ev) => { if (ev.target.matches("[data-new]")) startConsignment(ev); });
  $("consignmentSettings").addEventListener("submit", saveConsignmentSetting);
  // A sync landing while a pallet is being filled in must not wipe the form.
  Store.onChange(() => { if (!$("consignment").classList.contains("hidden") && cn.view !== "pallet") renderConsignment(); });
}
