// The Delivery Note role (the paper Afleweringsnota) on a phone: the recent
// notes, then one note to fill in - receiver and transporter (picked from
// Settings -> Delivery Note), seal, cooled to, the loading and offloading
// dates, and the pallets in this delivery, ticked off the Pallet Stack list and
// shown as it shows them, or for the juice buyer the full juice bins
// (juice.js) - and its PDF, laid out as the paper note, to print or share.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// delivery_note), editable like a pallet (consignment.js): saving again
// re-queues the whole record (rev). The note keeps its own copy of each
// pallet (the server's, taken when it is saved), so a pallet edited later
// leaves a note that has gone out as it was. Opens with the badge scan; a
// note keeps who made it and who last changed it. Uses Operator and
// renderOperatorBar from sulfur.js, $, esc from app.js and palletSummary,
// palletCartons, palletKg, kgText and sum from consignment.js.

// from: "juice" while a note opened from the Juice screen is open; leaving it goes back there.
let dn = { view: "list", draft: null, from: null };

// Done with the open note: back to the list it came from (the Juice screen's
// Delivery Notes, or this screen's).
function leaveNote() {
  dn.view = "list";
  if (dn.from === "juice") { dn.from = null; location.hash = "#juice"; return; }
  renderDeliveryNote();
  window.scrollTo(0, 0);
}
let sealScanner = null;
let sealConfirm = null; // twiceInARow (consignment.js)

const dnToday = () => new Date(Store.now()).toLocaleDateString("en-CA"); // YYYY-MM-DD, farm-local
const dnDay = (v) => (v ? v.split("-").reverse().join("/") : "");
// The day after a YYYY-MM-DD (noon, so a daylight-saving shift never skips a day).
function dayAfter(v) {
  if (!v) return "";
  const d = new Date(`${v}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}
// The number is typed on the first note (carrying on from the paper book), and
// every new note after it offers the last note number + 1: the server's (set
// in Settings, or the highest it has had), or a note this phone has not sent yet.
// Juice notes count on their own, from J-0001.
const isJuiceNote = (n) => (n.bins || []).length > 0;
function nextNoteNo(juice) {
  const unsent = Store.notes().filter((n) => n.synced === 0 && isJuiceNote(n) === juice).map((n) => n.note_no);
  const opts = Store.noteOptions();
  const last = Math.max((juice ? opts.last_juice_no : opts.last_no) || 0, ...unsent);
  if (juice) return String(last + 1).padStart(4, "0");
  return last ? String(last + 1) : "";
}
const receiverText = (r) => [r.name, r.market, r.address_1, r.address_2, r.city].filter(Boolean).join("\n");
const noteTotals = (pallets, bins = []) => (bins.length ? binsTotal(bins)
  : `<b>${pallets.length}</b> pallet${pallets.length === 1 ? "" : "s"} · <b>${sum(pallets, palletCartons)}</b> cartons · <b>${kgText(sum(pallets, palletKg))}</b>`);
const isExport = (group) => group === "usa" || group === "eu";

function renderDeliveryNote() {
  stopSealScan(); // the form is redrawn: its camera box goes with it
  renderOperatorBar($("deliveryOperatorBar"));
  $("deliveryOperatorBar").classList.toggle("hidden", dn.view === "note");
  $("deliveryBody").innerHTML = dn.view === "note" ? noteForm() : notesView();
}

// Today's notes (made on this phone's day, and any refused one whatever its
// day, so it is never lost), then every earlier one this phone holds (90
// days) greyed, still tapped to edit or delete. Each under a heading per
// market group (USA, EU, Local), newest first within it, with its market.
function notesView() {
  const today = (n) => sameDay(n.created_at) || n.error;
  const grouped = (notes, dim) => MARKET_GROUPS.map(([key]) => {
    const group = notes.filter((n) => noteGroup(n) === key);
    if (!group.length) return "";
    return groupHead(key, `${group.length} note${group.length === 1 ? "" : "s"}`) + group.map((n) => noteRow(n, dim)).join("");
  }).join("");
  const rows = grouped(Store.notes().filter(today));
  const earlier = Store.notes().filter((n) => !today(n));
  return `
    <div class="bg-white rounded-2xl shadow p-4">
      <button type="button" data-addnote class="w-full boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-file-lines"></i> New delivery note</button>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Delivery notes added today</div>
        <div class="text-xs text-white/80">Tap a note to edit, print or share it.</div>
      </div>
      ${rows || `<div class="text-center text-slate-400 text-sm py-6 border-t">No delivery notes yet today</div>`}
    </div>
    ${earlier.length ? `
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">Earlier delivery notes</div>
        <div class="text-base"><b>${earlier.length}</b> note${earlier.length === 1 ? "" : "s"}</div>
        <div class="text-xs text-white/80">Tap a note to edit, print, share or delete it.</div>
      </div>
      ${grouped(earlier, true)}
    </div>` : ""}`;
}

// A juice note's colour says what it holds: bins (orange), crates (yellow) or both (rose).
function juiceRowKey(n) {
  const kinds = new Set(n.bins.map(containerOf));
  return kinds.size > 1 ? "mixed" : kinds.has("crate") ? "crates" : "juice";
}

function noteRow(n, dim) {
  const key = noteGroup(n) === "juice" ? juiceRowKey(n) : noteGroup(n);
  return `
    <button type="button" data-note="${esc(n.uuid)}" class="${groupRow(key, false, "block", dim ? "opacity-50 grayscale" : "")}">
      <div class="flex justify-between gap-3 items-baseline">
        <div class="font-bold text-lg">Note ${esc(noteLabel(n))}</div>
        <div class="text-sm shrink-0">${esc(dnDay(n.loaded_on))}</div>
      </div>
      <div class="text-sm font-semibold text-blue-800">${esc(noteMarkets(n))}</div>
      <div class="text-sm truncate">${esc(n.receiver.split("\n")[0])}${n.transporter ? ` · ${esc(n.transporter)}` : ""}</div>
      <div class="text-sm">${noteTotals(n.pallets, n.bins || [])}</div>
      <div class="text-xs text-slate-500 truncate">${(n.bins || []).length ? esc(n.bins.map(binName).join(", "))
        : `Pallets ${n.pallets.map((p) => esc(p.pallet_ref)).join(", ")}`}</div>
      ${n.error ? `<div class="text-sm text-red-600 mt-1">Not saved: ${esc(n.error)}. Tap to fix it.</div>` : ""}
    </button>`;
}

// A juice note (opened from the Juice screen) holds juice bins and has no
// seal or cooled to; a new one starts with the receiver and transporter of
// the last juice note. Any other note holds pallets.
function openNote(note, juice = false) {
  const opts = Store.noteOptions();
  const last = juice && Store.notes().find(isJuiceNote) || {};
  dn.view = "note";
  dn.draft = note
    ? { uuid: note.uuid, note, juice: isJuiceNote(note), no: isJuiceNote(note) ? String(note.note_no).padStart(4, "0") : String(note.note_no),
        receiver_id: note.receiver_id, transporter_id: note.transporter_id,
        target_receiver_id: note.target_receiver_id == null ? null : note.target_receiver_id,
        seal_no: note.seal_no, cooled_to: note.cooled_to, loaded_on: note.loaded_on, offloaded_on: note.offloaded_on,
        picked: [...note.pallets, ...(note.bins || [])].map((p) => p.uuid) }
    : { uuid: Boord.uuid(), note: null, juice, no: nextNoteNo(juice), receiver_id: last.receiver_id == null ? null : last.receiver_id,
        transporter_id: last.transporter_id == null ? null : last.transporter_id, target_receiver_id: null, seal_no: "",
        cooled_to: juice || opts.cooled_to == null ? "" : String(opts.cooled_to), loaded_on: dnToday(), offloaded_on: dayAfter(dnToday()), picked: [] };
  renderDeliveryNote();
}

// Settings' list plus the note's own pick if it has since been retired, so
// editing an old note loses nothing (withOwn from consignment.js).
const receiverChoices = (d) => withOwn(Store.noteOptions().receivers || [],
  d.note && d.note.receiver_id != null && { id: d.note.receiver_id, name: d.note.receiver.split("\n")[0], text: d.note.receiver });
// An export note's target receivers: Settings' for its market (USA or EU),
// plus its own pick if since retired.
const targetText = (t) => [t.name, t.address].filter(Boolean).join("\n");
const targetChoices = (d, group) => withOwn((Store.noteOptions().target_receivers || []).filter((t) => t.market === groupTitle(group)),
  d.note && d.note.target_receiver_id != null && { id: d.note.target_receiver_id, name: d.note.target_receiver.split("\n")[0], text: d.note.target_receiver });
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

// The full juice bins and crates this note can hold, the same way: its own,
// then every full one on no other note (one waiting for a weight never shows).
function binChoices(d) {
  const taken = new Set(Store.notes().filter((n) => n.uuid !== d.uuid).flatMap((n) => (n.bins || []).map((b) => b.uuid)));
  const live = binsNewestFirst().filter((b) => binFull(b) && !taken.has(b.uuid) && !b.error);
  const own = (d.note ? d.note.bins || [] : []).filter((b) => !live.some((l) => l.uuid === b.uuid));
  return [...own, ...live];
}

const tickBox = (on) => `<i class="fa-${on ? "solid fa-square-check text-blue-700" : "regular fa-square text-slate-400"} text-2xl pt-1"></i>`;

function noteForm() {
  const d = dn.draft;
  const field = "w-full border border-slate-300 rounded-lg px-2 py-2.5";
  const label = (text, html, cls = "block") => `<label class="${cls}"><span class="text-xs font-semibold text-slate-600">${text}</span>${html}</label>`;
  const input = (f, extra = "") => `<input data-field="${f}" value="${esc(d[f])}" ${extra} class="${field}">`;
  const select = (f, rows, picked, blank, text) => `<select data-field="${f}" class="${field}"><option value="">${blank}</option>`
    + rows.map((r) => `<option value="${esc(r.id)}"${r.id === picked ? " selected" : ""}>${esc(text(r))}</option>`).join("") + `</select>`;
  // A juice note's full bins, or the pallets in their market groups; once
  // one is ticked the other groups can't be (a delivery is all USA, all EU
  // or all local).
  const choices = d.juice ? [] : palletChoices(d);
  const picked = choices.filter((p) => d.picked.includes(p.uuid));
  const bins = d.juice ? binChoices(d) : [];
  const pickedBins = bins.filter((b) => d.picked.includes(b.uuid));
  const locked = d.juice ? "juice" : picked.length ? marketGroup(picked[0].market_name) : null;
  const binRows = bins.length ? groupHead("juice", containerCounts(bins))
    + bins.map((b) => `
    <button type="button" data-pick="${esc(b.uuid)}" class="${groupRow("juice", d.picked.includes(b.uuid), "flex gap-3")}">
      ${tickBox(d.picked.includes(b.uuid))}<div class="flex-1 min-w-0">${binSummary(b)}</div>
    </button>`).join("") : "";
  const pallets = MARKET_GROUPS.map(([key]) => {
    const group = choices.filter((p) => marketGroup(p.market_name) === key);
    if (!group.length) return "";
    const off = locked && locked !== key;
    return groupHead(key, off ? `Not with ${groupTitle(locked)} pallets` : `${group.length} pallet${group.length === 1 ? "" : "s"}`, off)
      + group.map((p) => {
      const on = d.picked.includes(p.uuid);
      const freed = freedBy(p.uuid);
      return `
    <button type="button" data-pick="${esc(p.uuid)}" ${off ? "disabled" : ""} class="${groupRow(key, on, "flex gap-3", off ? "opacity-40" : "")}">
      ${tickBox(on)}
      <div class="flex-1 min-w-0">${palletSummary(p)}${freed && freed.uuid !== d.uuid ? freedTag(freed) : ""}</div>
    </button>`;
    }).join("");
  }).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-back class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${d.note ? `Delivery note ${esc(noteLabel(d.note))}` : d.juice ? "New Juice Delivery Note" : "New delivery note"}</div>
        ${locked ? `<div class="text-sm font-semibold text-blue-800">${esc(d.juice ? "Juice" : noteMarkets({ pallets: picked }))}</div>` : ""}
      </div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div class="flex gap-2">
        ${label(`Note no (${d.juice ? "J" : notePrefix(picked)}-)`, input("no", `inputmode="numeric" maxlength="6" placeholder="${d.juice ? "0001" : "1335"}"`), "w-28 shrink-0")}
        ${label("Transporter", select("transporter", transporterChoices(d), d.transporter_id, "Transporter...", (r) => r.name), "flex-1 min-w-0")}
      </div>
      ${label("Receiver", select("receiver", receiverChoices(d), d.receiver_id, "Receiver...", (r) => (r.text || receiverText(r)).split("\n").join(" · ")))}
      ${isExport(locked) ? label(`Target receiver (${groupTitle(locked)})`,
          select("target_receiver", targetChoices(d, locked), d.target_receiver_id, "Target receiver...", (t) => (t.text || targetText(t)).split("\n").join(" · "))) : ""}
      ${d.juice ? "" : `<div class="flex gap-2">
        <div class="flex-1 min-w-0"><span class="text-xs font-semibold text-slate-600">Seal no</span>
          <div class="flex gap-2">${input("seal_no", `placeholder="Scan or type" aria-label="Seal no"`)}
          <button type="button" data-scanseal title="Scan the seal's barcode" class="px-3 rounded-lg border border-slate-300"><i class="fa-solid fa-barcode text-xl"></i></button></div></div>
        ${label("Cooled to (°C)", input("cooled_to", `inputmode="decimal" maxlength="5"`), "w-28 shrink-0")}
      </div>
      <div id="sealReader" class="hidden w-full rounded-lg overflow-hidden bg-black min-h-[200px]"></div>
      <div id="sealMsg" class="text-sm text-red-600 empty:hidden"></div>`}
      <div class="flex gap-2">
        ${label("Load date", input("loaded_on", `type="date"`), "flex-1 min-w-0")}
        ${label("Offload date", input("offloaded_on", `type="date"`), "flex-1 min-w-0")}
      </div>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="${LIST_HEAD}">
        <div class="text-lg font-bold">${d.juice ? "Bins and crates" : "Pallets"} in this delivery</div>
        <div id="noteTotals" class="text-base">${d.juice ? binsTotal(pickedBins) : noteTotals(picked)}</div>
        <div class="text-xs text-white/80">${d.juice ? "Tick the full bins and crates that go in this delivery. One still waiting for its full weight is not listed."
          : "Tick the pallets from Pallet Stack that go in this delivery: all USA, all EU or all local."}</div>
      </div>
      ${(d.juice ? binRows : pallets) || `<div class="text-center text-slate-400 text-sm py-6 border-t">No ${d.juice ? "full bins or crates" : "pallets"} left to send</div>`}
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div id="noteMsg" class="text-sm text-red-600 empty:hidden">${d.note && d.note.error ? `Not saved: ${esc(d.note.error)}.` : ""}</div>
      <button type="button" data-savenote class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save delivery note</button>
      ${d.note ? `${!isExport(noteGroup(d.note)) /* local and juice: the Bekfontein delivery note; export: the market's spreadsheet instead */
                    ? `<button type="button" data-pdf class="w-full border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid fa-share-from-square"></i> Print or share</button>`
                    : exportButtons(d.note)}
                  <button type="button" data-removenote class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Delete delivery note</button>` : ""}
    </div>`;
}

// The seal's barcode, scanned like a pallet label (consignment.js). A browser
// only hands out the camera on https (or localhost): on the farm that is the
// Tailscale address.
async function startSealScan() {
  const msg = $("sealMsg");
  if (!window.isSecureContext) { msg.textContent = "Scanning needs the secure https://...ts.net:8060/ address - check Tailscale is connected, or type the number."; return; }
  if (sealScanner) return;
  msg.textContent = "";
  sealConfirm = twiceInARow();
  $("sealReader").classList.remove("hidden");
  const F = Html5QrcodeSupportedFormats;
  sealScanner = new Html5Qrcode("sealReader", { formatsToSupport: [F.CODE_128, F.CODE_39, F.ITF, F.EAN_13, F.QR_CODE], verbose: false });
  try {
    await sealScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 280, height: 110 } }, onSealCode, () => {});
  } catch (e) {
    sealScanner = null;
    $("sealReader").classList.add("hidden");
    msg.textContent = "Camera unavailable - allow camera access, then tap the barcode button, or type the number.";
  }
}

function stopSealScan() {
  const s = sealScanner;
  sealScanner = null;
  const reader = document.getElementById("sealReader");
  if (reader) reader.classList.add("hidden");
  if (s) try { Promise.resolve(s.stop()).then(() => s.clear()).catch(() => {}); } catch (_) { /* never started */ }
}

function onSealCode(text) {
  if (!sealScanner) return; // the camera reports a code many times a second
  if (!sealConfirm(text.trim())) return;
  stopSealScan();
  Boord.beepScanned();
  dn.draft.seal_no = text.trim();
  document.querySelector('#deliveryBody [data-field="seal_no"]').value = dn.draft.seal_no;
  $("sealMsg").textContent = "";
}

async function saveNote() {
  const d = dn.draft;
  const fail = (m) => { $("noteMsg").textContent = m; };
  const no = Number(d.no);
  const receiver = receiverChoices(d).find((r) => r.id === d.receiver_id);
  const transporter = transporterChoices(d).find((t) => t.id === d.transporter_id);
  const pallets = palletChoices(d).filter((p) => d.picked.includes(p.uuid));
  const bins = binChoices(d).filter((b) => d.picked.includes(b.uuid));
  if (!(no >= 1)) return fail("Type the note number.");
  const twin = Store.notes().find((n) => n.note_no === no && n.uuid !== d.uuid && isJuiceNote(n) === d.juice);
  if (twin) return fail(`Note ${noteLabel(twin)} is already used.`);
  if (!receiver) return fail("Pick the receiver.");
  if (!transporter) return fail("Pick the transporter.");
  if (!d.loaded_on) return fail("Pick the loading date.");
  if (d.juice ? !bins.length : !pallets.length) return fail(`Tick the ${d.juice ? "bins and crates" : "pallets"} in this delivery.`);
  if (new Set(pallets.map((p) => marketGroup(p.market_name))).size > 1) return fail("Untick the pallets of the other market: a delivery is all USA, all EU or all local.");
  // An export note's target receiver, if picked from its market's (a pick left over
  // from pallets of another market falls away).
  const group = bins.length ? "juice" : marketGroup(pallets[0].market_name);
  const target = isExport(group) ? targetChoices(d, group).find((t) => t.id === d.target_receiver_id) : null;
  const op = Operator.current() || {};
  const base = d.note || { kind: "delivery_note", created_at: new Date(Store.now()).toISOString(),
                           made_by: op.id || "", made_by_name: op.name || "" };
  await Store.saveRun({ ...base, kind: "delivery_note", uuid: d.uuid, note_no: no,
                        receiver_id: receiver.id, receiver: receiver.text || receiverText(receiver),
                        transporter_id: transporter.id, transporter: transporter.name,
                        target_receiver_id: target ? target.id : null, target_receiver: target ? target.text || targetText(target) : "",
                        seal_no: d.juice ? "" : d.seal_no.trim(), cooled_to: d.juice ? "" : d.cooled_to.trim(),
                        loaded_on: d.loaded_on, offloaded_on: d.offloaded_on, pallets, bins,
                        changed_by: op.id || "", changed_by_name: op.name || "", removed: false, rev: Date.now() });
  // Back to the list, where the note now shows; tap it there to print or share it.
  leaveNote();
}

// Wants the settings PIN (askPin, app.js); its pallets or bins are then free for another note.
function removeNote() {
  const note = dn.draft.note;
  if (!confirm(`Delete delivery note ${noteLabel(note)}?`)) return;
  askPin(`PIN to delete note ${noteLabel(note)}`, async () => {
    const op = Operator.current() || {};
    await Store.saveRun({ ...note, kind: "delivery_note", removed: true, changed_by: op.id || "",
                          changed_by_name: op.name || "", rev: Date.now() });
    leaveNote();
  });
}

// A note's group is its pallets' (one group to a note; an older mixed note
// goes by its first pallet), and its market the pallets' market names.
const noteGroup = (n) => ((n.bins || []).length ? "juice" : n.pallets.length ? marketGroup(n.pallets[0].market_name) : "local");
const noteMarkets = (n) => [...new Set(n.pallets.map((p) => p.market_name).filter(Boolean))].join(", ") || groupTitle(noteGroup(n));

// The note number's prefix: LW for a delivery of export (USA or EU)
// pallets, B for local; one series of numbers. A juice note has its own
// series, J-0001 on. As export_forms.note_label.
function notePrefix(pallets) {
  return (pallets || []).some((p) => marketGroup(p.market_name) !== "local") ? "LW" : "B";
}

function noteLabel(n) {
  return isJuiceNote(n) ? `J-${String(n.note_no).padStart(4, "0")}` : `${notePrefix(n.pallets)}-${n.note_no}`;
}

// A note of export pallets has their market's papers (USA: phyto,
// consignment and PPECB sheet; EU: the same but no phyto), drawn as the
// farm's forms, in place of the Bekfontein delivery note a local note
// prints. The market is read off the pallets' market names (USA Sea
// Freight, EU Air Freight). As Excel, or as one PDF of every sheet.
function exportButtons(note) {
  const markets = (note.pallets || []).map((p) => p.market_name || "");
  return EXPORT_MARKETS.filter(([, , re]) => markets.some((m) => re.test(m))).map(([key, label]) =>
    [["xlsx", "fa-file-excel", "Excel"], ["pdf", "fa-file-pdf", "PDF"]].map(([ext, icon, kind]) =>
      `<button type="button" data-export="${key}_forms.${ext}" class="w-full border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid ${icon}"></i> Print or share ${label} documents (${kind})</button>`).join("")).join("");
}

// The server makes the PDF, so the note must have reached it: a copy still
// in the outbox would print as it was before.
async function shareNote(papers) {
  const n = Store.notes().find((x) => x.uuid === dn.draft.uuid);
  const msg = $("noteMsg");
  if (!n || n.synced === 0) { msg.textContent = "Still sending this note - try again when the pill says synced."; Store.syncNow(); return; }
  msg.textContent = "";
  try {
    // papers: an export market's papers ("usa_forms.xlsx", "eu_forms.pdf"), else the note's PDF.
    const blob = await Boord.api(`/api/deliverynote/${encodeURIComponent(n.uuid)}/${papers || "pdf"}`);
    const name = papers ? papers.replace(".", `_${noteLabel(n)}.`) : `afleweringsnota_${noteLabel(n)}.pdf`;
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `Delivery note ${noteLabel(n)}` });
    else Boord.downloadBlob(blob, name);
  } catch (e) {
    if (e.name === "AbortError") return; // closed the share sheet
    msg.textContent = Boord.errorDetail(e, "No connection to the server - printing needs it.");
  }
}

function onDeliveryClick(ev) {
  const t = ev.target.closest("button");
  if (!t) return;
  const d = dn.draft;
  if (t.dataset.note) { dn.from = null; openNote(Store.notes().find((n) => n.uuid === t.dataset.note)); }
  else if ("addnote" in t.dataset) { dn.from = null; openNote(null); }
  else if ("back" in t.dataset) leaveNote();
  else if (t.dataset.pick) {
    const u = t.dataset.pick;
    if (t.disabled) return; // another market's pallet
    d.picked = d.picked.includes(u) ? d.picked.filter((x) => x !== u) : [...d.picked, u];
    const y = window.scrollY;
    renderDeliveryNote();
    window.scrollTo(0, y); // ticking a pallet far down the list must not jump to the top
  }
  else if ("scanseal" in t.dataset) (sealScanner ? stopSealScan() : startSealScan());
  else if ("savenote" in t.dataset) saveNote();
  else if ("pdf" in t.dataset) shareNote();
  else if (t.dataset.export) shareNote(t.dataset.export);
  else if ("removenote" in t.dataset) removeNote();
}

function onDeliveryInput(ev) {
  const f = ev.target.dataset.field;
  if (!f) return;
  const v = ev.target.value;
  if (f === "receiver" || f === "transporter" || f === "target_receiver") dn.draft[`${f}_id`] = v ? Number(v) : null;
  else if (f === "no") { dn.draft.no = v.replace(/\D/g, ""); ev.target.value = dn.draft.no; }
  else if (f === "loaded_on") {
    // The offload date follows the load date (the next day) until it is set by hand.
    const follows = !dn.draft.offloaded_on || dn.draft.offloaded_on === dayAfter(dn.draft.loaded_on);
    dn.draft.loaded_on = v;
    if (follows) {
      dn.draft.offloaded_on = dayAfter(v);
      document.querySelector('#deliveryBody [data-field="offloaded_on"]').value = dn.draft.offloaded_on;
    }
  }
  else dn.draft[f] = v;
}

// ---- Settings -> Delivery Note ----------------------------------------------

// One compact row a transporter, receiver or target receiver: name (a
// receiver's market, address and city beneath; a target receiver's USA or EU and
// address), In use, delete, save. The packs' rows (consignment.js), one field more.
const DN_KINDS = { transporters: ["New transporter", "Transporter"], receivers: ["New receiver", "Receiver, then its market, address and city"],
                   targetreceivers: ["New target receiver", "Target receiver, then its market (USA or EU) and address"] };
function dnSettingsRow(kind, row) {
  const isNew = row.id == null;
  const box = "border border-slate-300 rounded-lg px-2 py-2";
  const extra = kind === "receivers" ? `
      <div class="flex gap-1.5 mt-1.5">
        <input name="market" value="${esc(row.market)}" placeholder="Market" class="flex-1 min-w-0 ${box}">
        <input name="address_1" value="${esc(row.address_1)}" placeholder="Address 1" class="flex-1 min-w-0 ${box}">
      </div>
      <div class="flex gap-1.5 mt-1.5">
        <input name="address_2" value="${esc(row.address_2)}" placeholder="Address 2" class="flex-1 min-w-0 ${box}">
        <input name="city" value="${esc(row.city)}" placeholder="City" class="flex-1 min-w-0 ${box}">
      </div>` : kind === "targetreceivers" ? `
      <div class="flex gap-1.5 mt-1.5">
        <select name="market" class="w-20 shrink-0 ${box}">${["USA", "EU"].map((m) => `<option${row.market === m ? " selected" : ""}>${m}</option>`).join("")}</select>
        <input name="address" value="${esc(row.address)}" placeholder="Address" class="flex-1 min-w-0 ${box}">
      </div>` : "";
  return `
    <form class="py-2" data-dn-form="${kind}" data-id="${isNew ? "new" : row.id}">
      <div class="flex items-center gap-1.5">
        <input name="name" value="${esc(row.name)}" placeholder="${isNew ? DN_KINDS[kind][0] : ""}" class="flex-1 min-w-0 font-semibold ${box}">
        ${isNew ? `<span class="w-10 shrink-0"></span><span class="w-10 shrink-0"></span>`
          : `<label class="w-10 shrink-0 flex justify-center" title="In use"><input name="active" type="checkbox"${row.active ? " checked" : ""} class="w-5 h-5"></label>
             <button type="button" data-dn-delete title="Delete" class="w-10 h-10 shrink-0 rounded-lg border border-red-300 text-red-700"><i class="fa-solid fa-trash-can"></i></button>`}
        <button class="w-14 shrink-0 h-10 ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg font-semibold">${isNew ? "Add" : "Save"}</button>
      </div>${extra}
    </form>`;
}

function dnSettingsCard(kind, rows) {
  const head = `<div class="flex gap-1.5 pt-3 text-xs text-slate-500"><span class="flex-1">${DN_KINDS[kind][1]}</span>`
    + `<span class="w-10 shrink-0 text-center">In use</span><span class="w-10 shrink-0"></span><span class="w-14 shrink-0"></span></div>`;
  return `<div class="bg-white rounded-2xl shadow px-3 pb-1 divide-y divide-slate-100">${head}`
    + rows.map((r) => dnSettingsRow(kind, r)).join("") + dnSettingsRow(kind, { id: null, name: "", market: "", address_1: "", address_2: "", city: "", address: "" }) + `</div>`;
}

async function loadDeliverySettings() {
  try {
    const [transporters, receivers, targets, opts] = await Promise.all([Boord.api("/api/settings/transporters"),
      Boord.api("/api/settings/receivers"), Boord.api("/api/settings/targetreceivers"), Boord.api("/api/deliverynote/options")]);
    $("transporterSettings").innerHTML = dnSettingsCard("transporters", transporters);
    $("receiverSettings").innerHTML = dnSettingsCard("receivers", receivers);
    $("targetReceiverSettings").innerHTML = dnSettingsCard("targetreceivers", targets);
    $("dnCooledTo").value = opts.cooled_to;
    $("dnLastNo").value = opts.last_no || "";
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("transporterSettings").innerHTML = $("receiverSettings").innerHTML = $("targetReceiverSettings").innerHTML = `<div class="text-sm text-slate-500">These can only be changed while the server can be reached.</div>`;
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
    const last = $("dnLastNo").value.trim();
    dnSettingsCall("/api/settings/deliverynote", { method: "PUT", body: { cooled_to: Number($("dnCooledTo").value),
                                                                          last_no: last ? Number(last) : null } }, "Saved");
    return;
  }
  const form = ev.target.closest("[data-dn-form]");
  if (!form) return;
  const f = new FormData(form);
  const kind = form.dataset.dnForm;
  const isNew = form.dataset.id === "new";
  const body = { name: f.get("name"), active: isNew ? true : f.get("active") === "on" };
  if (kind === "receivers") Object.assign(body, { market: f.get("market"), address_1: f.get("address_1"), address_2: f.get("address_2"), city: f.get("city") });
  if (kind === "targetreceivers") Object.assign(body, { market: f.get("market"), address: f.get("address") });
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
