// The Delivery Note role (the paper Afleweringsnota) on a phone: the recent
// notes, then one note to fill in - receiver, transporter, seal, cooled to,
// what is on the truck (number x description) and the loading and offloading
// dates - and its PDF, laid out as the paper note, to print or share.
//
// Made on the phone with a uuid and queued in Store's outbox (kind
// delivery_note), editable like a pallet (consignment.js): saving again
// re-queues the whole record (rev). Opens with the badge scan; a note keeps
// who made it and who last changed it. Uses Operator and renderOperatorBar
// from sulfur.js, $, esc from app.js.

let dn = { view: "list", draft: null };

const dnToday = () => new Date(Store.now()).toLocaleDateString("en-CA"); // YYYY-MM-DD, farm-local
const dnDay = (v) => (v ? v.split("-").reverse().join("/") : "");
// The number runs on from the highest note: typed once, carrying on from the paper book.
function nextNoteNo() {
  const used = Store.notes().map((n) => n.note_no);
  return used.length ? String(Math.max(...used) + 1) : "";
}
// What earlier notes said, newest first, for picking again.
function earlier(f) {
  return [...new Set(Store.notes().map(f).filter(Boolean))];
}

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
      <ul class="mt-1 text-sm">${n.lines.map((l) => `<li><b>${l.count}</b> x ${esc(l.description)}</li>`).join("")}</ul>
      ${n.error ? `<div class="text-sm text-red-600 mt-1">Not saved: ${esc(n.error)}. Tap to fix it.</div>` : ""}
    </button>`).join("");
  return `
    <div class="bg-white rounded-2xl shadow p-4">
      <button type="button" data-addnote class="w-full boord-btn-primary rounded-xl py-5 text-xl font-bold"><i class="fa-solid fa-file-lines"></i> New delivery note</button>
    </div>
    <div class="bg-white rounded-2xl shadow px-4 pb-1">
      <div class="font-semibold pt-3">Recent delivery notes</div>
      <div class="text-xs text-slate-500 pb-2">Tap a note to edit, print or share it.</div>
      ${rows || `<div class="text-center text-slate-400 text-sm py-6 border-t">No delivery notes yet</div>`}
    </div>`;
}

function openNote(note) {
  dn.view = "note";
  dn.draft = note
    ? { uuid: note.uuid, note, no: String(note.note_no), receiver: note.receiver, transporter: note.transporter,
        seal_no: note.seal_no, cooled_to: note.cooled_to, loaded_on: note.loaded_on, offloaded_on: note.offloaded_on,
        lines: note.lines.map((l) => ({ ...l })) }
    : { uuid: Boord.uuid(), note: null, no: nextNoteNo(), receiver: "", transporter: "", seal_no: "", cooled_to: "",
        loaded_on: dnToday(), offloaded_on: "", lines: [{ count: "", description: "" }] };
  renderDeliveryNote();
}

function noteForm() {
  const d = dn.draft;
  const field = "w-full border border-slate-300 rounded-lg px-2 py-2.5";
  const label = (text, html, cls = "block") => `<label class="${cls}"><span class="text-xs font-semibold text-slate-600">${text}</span>${html}</label>`;
  const input = (f, extra = "") => `<input data-field="${f}" value="${esc(d[f])}" ${extra} class="${field}">`;
  // The packs' names as starting points, then what earlier notes said.
  const descriptions = [...new Set([...earlier((n) => n.lines.map((l) => l.description)).flat(),
                                   ...Store.packaging().map((p) => `${p.name} Litchis`)])];
  const receivers = earlier((n) => n.receiver).slice(0, 5);
  const lines = d.lines.map((l, i) => `
    <div class="flex gap-1.5 items-center" data-line="${i}">
      <input data-field="count" inputmode="numeric" maxlength="5" placeholder="Qty" value="${esc(l.count)}" class="w-16 shrink-0 border border-slate-300 rounded-lg px-2 py-3">
      <input data-field="description" list="dnDescriptions" placeholder="1kg XL TMR Litchis" value="${esc(l.description)}" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-3">
      <button type="button" data-dropline="${i}" title="Delete this line" class="w-8 shrink-0 py-3 text-slate-400"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join("");
  return `
    <div class="flex items-center gap-3">
      <button type="button" data-back class="px-3 py-2 rounded-lg border border-slate-300 bg-white"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="flex-1 font-semibold">${d.note ? `Delivery note ${esc(d.note.note_no)}` : "New delivery note"}</div>
    </div>
    <div class="bg-white rounded-2xl shadow p-4 space-y-3">
      <div class="flex gap-2">
        ${label("Note no", input("no", `inputmode="numeric" maxlength="6" placeholder="1335"`), "w-24 shrink-0")}
        ${label("Transporter", input("transporter", `list="dnTransporters" placeholder="Self"`), "flex-1 min-w-0")}
      </div>
      ${label("Receiver", `<textarea data-field="receiver" rows="3" placeholder="Name, market, town" class="${field}">${esc(d.receiver)}</textarea>`)}
      ${receivers.length ? `<div class="flex flex-wrap gap-1.5 -mt-1">${receivers.map((r, i) => `<button type="button" data-receiver="${i}" class="text-xs border border-slate-300 rounded-full px-2 py-1 max-w-full truncate">${esc(r.split("\n")[0])}</button>`).join("")}</div>` : ""}
      <div class="flex gap-2">
        ${label("Seal no", input("seal_no"), "flex-1 min-w-0")}
        ${label("Cooled to (°C)", input("cooled_to", `inputmode="decimal" maxlength="5"`), "w-28 shrink-0")}
      </div>
      <div class="flex gap-2">
        ${label("Loaded", input("loaded_on", `type="date"`), "flex-1 min-w-0")}
        ${label("Offloaded", input("offloaded_on", `type="date"`), "flex-1 min-w-0")}
      </div>
      <div class="text-sm font-semibold text-slate-600">What is on the truck</div>
      ${lines}
      <button type="button" data-addline class="text-blue-700 font-semibold"><i class="fa-solid fa-plus"></i> Another line</button>
      <div id="noteMsg" class="text-sm text-red-600 empty:hidden">${d.note && d.note.error ? `Not saved: ${esc(d.note.error)}.` : ""}</div>
      <button type="button" data-savenote class="w-full boord-btn-primary rounded-xl py-4 text-lg font-bold">Save delivery note</button>
      ${d.note ? `<button type="button" data-pdf class="w-full border border-slate-300 rounded-xl py-3 font-semibold"><i class="fa-solid fa-share-from-square"></i> Print or share</button>
                  <button type="button" data-removenote class="w-full border border-red-300 text-red-700 rounded-xl py-3 font-semibold">Delete delivery note</button>` : ""}
    </div>
    <datalist id="dnDescriptions">${descriptions.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
    <datalist id="dnTransporters">${earlier((n) => n.transporter).map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`;
}

async function saveNote() {
  const d = dn.draft;
  const fail = (m) => { $("noteMsg").textContent = m; };
  const no = Number(d.no);
  const lines = d.lines.filter((l) => l.count !== "" || l.description.trim())
    .map((l) => ({ count: Number(l.count), description: l.description.trim() }));
  if (!(no >= 1)) return fail("Type the note number.");
  const twin = Store.notes().find((n) => n.note_no === no && n.uuid !== d.uuid);
  if (twin) return fail(`Note ${no} is already used.`);
  if (!d.receiver.trim()) return fail("Fill in the receiver.");
  if (!d.loaded_on) return fail("Pick the loading date.");
  if (!lines.length) return fail("Fill in what is on the truck.");
  if (lines.some((l) => !(l.count >= 1) || !l.description)) return fail("Every line needs a number and what it is.");
  const op = Operator.current() || {};
  const base = d.note || { kind: "delivery_note", created_at: new Date(Store.now()).toISOString(),
                           made_by: op.id || "", made_by_name: op.name || "" };
  await Store.saveRun({ ...base, kind: "delivery_note", uuid: d.uuid, note_no: no, receiver: d.receiver.trim(),
                        transporter: d.transporter.trim(), seal_no: d.seal_no.trim(), cooled_to: d.cooled_to.trim(),
                        loaded_on: d.loaded_on, offloaded_on: d.offloaded_on, lines,
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
  else if (t.dataset.receiver) { d.receiver = earlier((n) => n.receiver)[Number(t.dataset.receiver)]; renderDeliveryNote(); }
  else if ("addline" in t.dataset) { d.lines.push({ count: "", description: "" }); renderDeliveryNote(); }
  else if (t.dataset.dropline) {
    const i = Number(t.dataset.dropline);
    if (d.lines[i].count !== "" && !confirm(`Delete line ${i + 1}?`)) return;
    d.lines.splice(i, 1);
    if (!d.lines.length) d.lines.push({ count: "", description: "" });
    renderDeliveryNote();
  }
  else if ("savenote" in t.dataset) saveNote();
  else if ("pdf" in t.dataset) shareNote();
  else if ("removenote" in t.dataset) removeNote();
}

function onDeliveryInput(ev) {
  const f = ev.target.dataset.field;
  if (!f) return;
  Operator.touch();
  const row = ev.target.closest("[data-line]");
  if (!row) { dn.draft[f] = f === "no" ? ev.target.value.replace(/\D/g, "") : ev.target.value; if (f === "no") ev.target.value = dn.draft.no; return; }
  const line = dn.draft.lines[Number(row.dataset.line)];
  if (f === "count") { line.count = ev.target.value.replace(/\D/g, ""); ev.target.value = line.count; }
  else line.description = ev.target.value;
}

function initDeliveryNote() {
  const body = $("deliveryBody");
  body.addEventListener("click", onDeliveryClick);
  body.addEventListener("input", onDeliveryInput);
  body.addEventListener("change", onDeliveryInput);
  // A sync landing while a note is being filled in must not wipe the form.
  Store.onChange(() => { if (!$("deliverynote").classList.contains("hidden") && dn.view !== "note") renderDeliveryNote(); });
  setInterval(() => { if (!$("deliverynote").classList.contains("hidden") && !Operator.current()) show(); }, 30000);
}
