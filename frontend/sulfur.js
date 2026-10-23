// The Sulfur tent role: badge scan, one card per tent, countdowns, the home
// tile, the alarm, and Settings -> Tents.
//
// Runs live in Store (sync.js): made here, queued on the tablet, sent when
// the Wi-Fi allows. Every countdown is worked out on this tablet from the
// run's start time and Store.now(), so a dropout never stops a timer or its
// alarm. Uses $ and esc from app.js, which loads after this file.

// --------------------------------------------------------------------------
// Operator: who is working, from their Boord badge. Stamped on every run
// they start or end; cleared by Home, or after OPERATOR_IDLE_MS untouched.
// --------------------------------------------------------------------------
const OPERATOR_IDLE_MS = 15 * 60 * 1000;

const Operator = {
  current() {
    try {
      const o = JSON.parse(localStorage.getItem("ph_operator"));
      if (o && Date.now() - o.at < OPERATOR_IDLE_MS) return o.worker;
    } catch (_) { /* none */ }
    return null;
  },
  set(worker) { localStorage.setItem("ph_operator", JSON.stringify({ worker, at: Date.now() })); },
  touch() { const w = this.current(); if (w) this.set(w); },
  clear() { localStorage.removeItem("ph_operator"); },
};

let scanner = null;
let decoded = false;

function showCamera(on) {
  $("qrReader").classList.toggle("hidden", !on);
  $("scanCancel").classList.toggle("hidden", !on);
  $("scanBtn").classList.toggle("hidden", on);
}

async function startCamera() {
  // A browser only hands out the camera on https (or localhost): on the
  // farm that is the Tailscale address, as for Boord Field and Labour.
  if (!window.isSecureContext) {
    $("scanMsg").textContent = "Scanning needs the secure https://...ts.net:8060/ address - check Tailscale is connected.";
    return;
  }
  if (scanner) return;
  decoded = false;
  $("scanMsg").textContent = "";
  showCamera(true);
  scanner = new Html5Qrcode("qrReader");
  try {
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, onBadge, () => {});
  } catch (e) {
    scanner = null;
    showCamera(false);
    $("scanMsg").textContent = "Camera unavailable - allow camera access, then tap Scan your badge.";
  }
}

function stopCamera() {
  showCamera(false);
  if (!scanner) return;
  const s = scanner;
  scanner = null;
  try { Promise.resolve(s.stop()).then(() => s.clear()).catch(() => {}); } catch (_) { /* never started */ }
}

// The badge QR holds exactly the Boord worker.id. Looked up in this
// tablet's copy of the worker list, so it works with no signal.
async function onBadge(text) {
  if (decoded) return; // the camera reports a badge many times a second
  decoded = true;
  stopCamera();
  const id = text.trim();
  let worker = Store.workers().find((w) => w.id === id);
  if (!worker) {
    await Store.refreshWorkers(); // added in Boord since the last refresh?
    worker = Store.workers().find((w) => w.id === id);
  }
  if (!worker) {
    Boord._tone(220, 0.35);
    $("scanMsg").textContent = `Badge "${id}" is not an active Boord worker.`;
    return;
  }
  Boord.beepScanned();
  Operator.set(worker);
  show();
}

// --------------------------------------------------------------------------
// Runs and their timers
// --------------------------------------------------------------------------
const ALARM_EVERY_MS = 4000;
let lastAlarm = 0;
const drafts = {};          // tent id -> {grams, minutes, crates, source} being filled in
let sulfurSignature = "";   // what the cards were last built from

const activeRuns = () => Store.runs().filter((r) => !r.ended_at);
const endsAt = (r) => Date.parse(r.started_at) + r.minutes * 60000;

function fmtClock(ms) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function sourceLabel(s) {
  return s.supplier_id != null
    ? `Bought-in: ${s.supplier_name}`
    : `${s.block_name}${s.variety ? ` · ${s.variety}` : ""}`;
}

function findSource(key) {
  for (const g of Store.sources()) for (const s of g.sources) if (s.key === key) return s;
  return null;
}

function draftFor(tent) {
  if (!drafts[tent.id]) {
    const today = Store.sources().find((g) => g.label === "Today");
    drafts[tent.id] = {
      grams: tent.default_grams, minutes: tent.default_minutes, crates: tent.default_crates,
      // Pre-selected only when exactly one source came in today - with
      // several, the operator has to choose, so nobody starts on the wrong one.
      source: today && today.sources.length === 1 ? today.sources[0].key : "",
    };
  }
  return drafts[tent.id];
}

function sourceOptions(selected) {
  const groups = Store.sources().filter((g) => g.sources.length);
  if (!groups.length) return `<option value="">No fruit received today or on the last receiving day</option>`;
  return `<option value="">Choose the fruit...</option>` + groups.map((g) =>
    `<optgroup label="${esc(g.label)}">` + g.sources.map((s) =>
      `<option value="${esc(s.key)}"${s.key === selected ? " selected" : ""}>${esc(sourceLabel(s))} (${s.crates} crates)</option>`).join("")
    + `</optgroup>`).join("");
}

function idleCard(tent) {
  const d = draftFor(tent);
  return `
    <div class="bg-white rounded-2xl shadow p-4 space-y-3" data-tent="${tent.id}">
      <div class="flex items-center justify-between">
        <div class="text-2xl font-bold">${esc(tent.name)}</div>
        <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">Ready</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-xs text-slate-500">Sulfur (g)</span>
          <input data-field="grams" type="number" inputmode="decimal" min="1" value="${esc(d.grams)}"
                 class="w-full border border-slate-300 rounded-lg p-3 text-xl"></label>
        <label class="block"><span class="text-xs text-slate-500">Crates</span>
          <input data-field="crates" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.crates)}"
                 class="w-full border border-slate-300 rounded-lg p-3 text-xl"></label>
      </div>
      <div>
        <span class="text-xs text-slate-500">Time</span>
        <div class="grid grid-cols-3 gap-2 items-center">
          <button type="button" data-step="-5" class="keypad-btn font-bold">−5</button>
          <div class="text-center text-2xl font-bold"><span data-minutes>${esc(d.minutes)}</span> min</div>
          <button type="button" data-step="5" class="keypad-btn font-bold">+5</button>
        </div>
      </div>
      <label class="block"><span class="text-xs text-slate-500">Fruit source</span>
        <select data-field="source" class="w-full border border-slate-300 rounded-lg p-3 text-lg bg-white">${sourceOptions(d.source)}</select></label>
      <button type="button" data-start class="w-full boord-btn-primary rounded-xl py-4 text-xl font-bold">
        <i class="fa-solid fa-play"></i> Start</button>
    </div>`;
}

function runBlock(r, several) {
  const source = r.supplier_id != null ? `Bought-in: ${r.supplier_name}` : `${r.block_name}${r.variety ? ` (${r.variety})` : ""}`;
  const started = new Date(Date.parse(r.started_at));
  return `
    <div class="space-y-2${several ? " border-t pt-3" : ""}">
      <div class="text-center">
        <div data-countdown="${esc(r.uuid)}" class="text-6xl font-mono font-bold"></div>
        <div data-countdown-label="${esc(r.uuid)}" class="text-sm text-slate-500"></div>
      </div>
      <div class="text-sm text-slate-600 text-center">
        ${esc(r.grams)} g · ${esc(r.crates)} crates · ${esc(source)}<br>
        Started ${esc(Boord.fmtTime(started))} by ${esc(r.started_by_name || r.started_by)} · ${esc(r.minutes)} min
        ${r.synced === 0 ? `<br><span class="text-amber-700"><i class="fa-solid fa-cloud-arrow-up"></i> Not sent to the server yet</span>` : ""}
      </div>
      <button type="button" data-done="${esc(r.uuid)}" class="w-full bg-green-600 text-white rounded-xl py-4 text-xl font-bold">
        <i class="fa-solid fa-check"></i> Done - tent opened</button>
    </div>`;
}

function runningCard(tent, runs) {
  return `
    <div class="bg-white rounded-2xl shadow p-4 space-y-3" data-tent="${tent.id}" data-running-card>
      <div class="flex items-center justify-between">
        <div class="text-2xl font-bold">${esc(tent.name)}</div>
        <span data-tent-badge class="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">Running</span>
      </div>
      ${runs.length > 1 ? `<div class="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
        <i class="fa-solid fa-triangle-exclamation"></i> ${runs.length} runs are going in this tent - probably started on two tablets while the Wi-Fi was down. Press Done on each one that has finished.</div>` : ""}
      ${runs.map((r) => runBlock(r, runs.length > 1)).join("")}
    </div>`;
}

// Cards are rebuilt only when what they show changes, never by the 1-second
// tick or a sync that brought nothing new - a rebuild would wipe whatever
// the operator is typing.
function renderSulfur(force = false) {
  if ($("sulfur").classList.contains("hidden")) return;
  const op = Operator.current();
  const tents = Store.tents();
  const runs = activeRuns();
  const signature = JSON.stringify([tents, runs.map((r) => [r.uuid, r.synced]), Store.sources(), op && op.id]);
  if (!force && signature === sulfurSignature) return;
  sulfurSignature = signature;

  $("operatorBar").innerHTML = op ? `
    ${op.photo ? `<img src="${esc(op.photo)}" class="w-10 h-10 rounded-full object-cover" alt="">`
               : `<i class="fa-solid fa-user-circle text-4xl text-slate-400"></i>`}
    <div class="flex-1"><div class="text-xs text-slate-500">Operator</div><div class="font-bold">${esc(op.name)}</div></div>
    <button type="button" id="notMeBtn" class="text-sm underline text-slate-600">Not you?</button>` : "";
  if ($("notMeBtn")) $("notMeBtn").onclick = () => { Operator.clear(); show(); };

  $("tentCards").innerHTML = tents.length
    ? tents.map((t) => {
      const mine = runs.filter((r) => r.tent_id === t.id);
      return mine.length ? runningCard(t, mine) : idleCard(t);
    }).join("")
    : `<div class="bg-white rounded-2xl shadow p-6 text-center text-slate-500">No tents yet - add them in Settings &rarr; Tents.
       ${navigator.onLine ? "" : "<br>This tablet has not reached the server yet."}</div>`;
  tick();
}

async function startRun(card) {
  const tent = Store.tents().find((t) => t.id === Number(card.dataset.tent));
  const op = Operator.current();
  if (!tent) return;
  if (!op) { show(); return; }
  const d = draftFor(tent);
  const grams = Number(d.grams);
  const crates = Number(d.crates);
  const minutes = Number(d.minutes);
  const source = findSource(d.source);
  if (!(grams > 0)) return Boord.toast("Enter the grams of sulfur");
  if (!(Number.isInteger(crates) && crates >= 1)) return Boord.toast("Enter the number of crates");
  if (!source) return Boord.toast("Choose the fruit source");
  await Store.saveRun({
    uuid: Boord.uuid(), tent_id: tent.id, tent_name: tent.name,
    grams, minutes, crates,
    block_id: source.block_id ?? null, block_name: source.block_name || "", variety: source.variety || "",
    supplier_id: source.supplier_id ?? null, supplier_name: source.supplier_name || "",
    started_at: new Date(Store.now()).toISOString(), started_by: op.id, started_by_name: op.name,
    ended_at: null, ended_by: "", ended_by_name: "",
  });
  delete drafts[tent.id];
  Boord.beepSaved();
}

async function endRun(uuid) {
  const run = Store.runs().find((r) => r.uuid === uuid);
  const op = Operator.current();
  if (!run) return;
  if (!op) { show(); return; }
  if (!confirm(`Done with ${run.tent_name}? This stops its timer.`)) return;
  await Store.saveRun({ ...run, ended_at: new Date(Store.now()).toISOString(), ended_by: op.id, ended_by_name: op.name });
  Boord.beepSaved();
}

function onSulfurInput(ev) {
  Operator.touch();
  const card = ev.target.closest("[data-tent]");
  const field = ev.target.dataset.field;
  if (card && field) draftFor(Store.tents().find((t) => t.id === Number(card.dataset.tent)) || {})[field] = ev.target.value;
}

function onSulfurClick(ev) {
  Operator.touch();
  const card = ev.target.closest("[data-tent]");
  const step = ev.target.closest("[data-step]");
  if (step && card) {
    const d = draftFor(Store.tents().find((t) => t.id === Number(card.dataset.tent)));
    d.minutes = Math.min(600, Math.max(5, Number(d.minutes) + Number(step.dataset.step)));
    card.querySelector("[data-minutes]").textContent = d.minutes;
    return;
  }
  if (ev.target.closest("[data-start]") && card) { startRun(card); return; }
  const done = ev.target.closest("[data-done]");
  if (done) endRun(done.dataset.done);
}

// --------------------------------------------------------------------------
// The 1-second tick: countdowns, the home tile, the alarm, the screen lock.
// --------------------------------------------------------------------------
function homeTileStatus() {
  const el = $("tileStatus-sulfur");
  if (!el) return;
  const order = new Map(Store.tents().map((t, i) => [t.id, i]));
  const runs = activeRuns().sort((a, b) => (order.get(a.tent_id) ?? 99) - (order.get(b.tent_id) ?? 99));
  const now = Store.now();
  el.innerHTML = runs.length ? runs.map((r) => {
    const left = endsAt(r) - now;
    return left > 0
      ? `<div class="text-sm font-semibold text-slate-700">${esc(r.tent_name)}: ${Math.ceil(left / 60000)} min left</div>`
      : `<div class="text-sm font-bold text-red-600">${esc(r.tent_name)}: +${Math.floor(-left / 60000)} min over</div>`;
  }).join("") : `<div class="text-xs text-slate-400 mt-1">No tents running</div>`;
}

let wakeLock = null;
let wakeLockAsked = false;
async function holdScreen(on) {
  if (on && !wakeLock && !wakeLockAsked && "wakeLock" in navigator && document.visibilityState === "visible") {
    wakeLockAsked = true;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_) { /* refused or unsupported: the screen may sleep */ }
    wakeLockAsked = false;
  } else if (!on && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function soundAlarm() {
  Boord._tone(880, 0.25);
  Boord._tone(660, 0.25, 0.3);
  Boord._tone(880, 0.25, 0.6);
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}

function tick() {
  const now = Store.now();
  const runs = activeRuns();
  for (const r of runs) {
    const left = endsAt(r) - now;
    const el = document.querySelector(`[data-countdown="${CSS.escape(r.uuid)}"]`);
    if (el) {
      el.textContent = left > 0 ? fmtClock(left) : `+${fmtClock(left)}`;
      el.classList.toggle("text-red-600", left <= 0);
      el.classList.toggle("text-green-700", left > 0);
      document.querySelector(`[data-countdown-label="${CSS.escape(r.uuid)}"]`).textContent =
        left > 0 ? "left" : "OVER TIME - open the tent";
      const card = el.closest("[data-running-card]");
      card.classList.toggle("ring-4", left <= 0);
      card.classList.toggle("ring-red-500", left <= 0);
      const badge = card.querySelector("[data-tent-badge]");
      badge.textContent = left > 0 ? "Running" : "Time's up";
      badge.className = `text-xs px-2 py-1 rounded-full ${left > 0 ? "bg-amber-100 text-amber-800" : "bg-red-600 text-white"}`;
    }
  }
  homeTileStatus();
  holdScreen(runs.length > 0);

  // The alarm sounds on the sulfur screen and the home screen until Done is
  // pressed. A browser only plays sound once the tablet has been touched
  // since it was opened - see the pointerdown handler below.
  const overdue = runs.some((r) => endsAt(r) <= now);
  const visible = !$("sulfur").classList.contains("hidden") || !$("home").classList.contains("hidden");
  if (overdue && visible && document.visibilityState === "visible" && Date.now() - lastAlarm >= ALARM_EVERY_MS) {
    lastAlarm = Date.now();
    soundAlarm();
  }

  // The operator went idle while this screen was open: back to the badge.
  if (!$("sulfur").classList.contains("hidden") && !Operator.current()) show();
}

// --------------------------------------------------------------------------
// Settings -> Tents (behind the PIN; uses unlocked and show from app.js)
// --------------------------------------------------------------------------
function tentRow(t) {
  const isNew = t.id == null;
  return `
    <form class="bg-white rounded-2xl shadow p-4 space-y-3" data-tent-form="${isNew ? "new" : t.id}">
      <div class="flex items-center justify-between gap-3">
        <input name="name" value="${esc(t.name)}" placeholder="Tent name" class="flex-1 border border-slate-300 rounded-lg p-2 text-lg font-semibold">
        ${isNew ? "" : `<label class="text-sm flex items-center gap-2"><input name="active" type="checkbox"${t.active ? " checked" : ""} class="w-5 h-5"> In use</label>`}
      </div>
      <div class="grid grid-cols-3 gap-2">
        <label class="block"><span class="text-xs text-slate-500">Sulfur (g)</span>
          <input name="default_grams" type="number" inputmode="decimal" value="${esc(t.default_grams)}" class="w-full border border-slate-300 rounded-lg p-2"></label>
        <label class="block"><span class="text-xs text-slate-500">Minutes</span>
          <input name="default_minutes" type="number" inputmode="numeric" value="${esc(t.default_minutes)}" class="w-full border border-slate-300 rounded-lg p-2"></label>
        <label class="block"><span class="text-xs text-slate-500">Crates</span>
          <input name="default_crates" type="number" inputmode="numeric" value="${esc(t.default_crates)}" class="w-full border border-slate-300 rounded-lg p-2"></label>
      </div>
      <button class="w-full ${isNew ? "boord-btn-primary" : "border border-slate-300"} rounded-lg py-2 font-semibold">${isNew ? "Add tent" : "Save"}</button>
    </form>`;
}

async function loadTentSettings() {
  let tents;
  try {
    tents = await Boord.api("/api/settings/tents");
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("tentSettings").innerHTML = `<div class="text-sm text-slate-500">Tents can only be changed while the server can be reached.</div>`;
    return;
  }
  $("tentSettings").innerHTML = tents.map(tentRow).join("")
    + `<div class="text-sm font-semibold text-slate-600 pt-2">Add a tent</div>`
    + tentRow({ id: null, name: "", default_grams: 425, default_minutes: 60, default_crates: 24, active: true });
}

async function saveTent(ev) {
  const form = ev.target.closest("[data-tent-form]");
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form);
  const body = {
    name: f.get("name"), default_grams: Number(f.get("default_grams")),
    default_minutes: Number(f.get("default_minutes")), default_crates: Number(f.get("default_crates")),
    active: form.dataset.tentForm === "new" ? true : f.get("active") === "on",
  };
  const isNew = form.dataset.tentForm === "new";
  try {
    await Boord.api(isNew ? "/api/settings/tents" : `/api/settings/tents/${form.dataset.tentForm}`,
      { method: isNew ? "POST" : "PUT", body });
    Boord.toast(isNew ? "Tent added" : "Tent saved");
    await loadTentSettings();
    Store.syncNow(); // the sulfur screen picks the change up
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

function initSulfur() {
  $("scanBtn").addEventListener("click", startCamera);
  $("scanCancel").addEventListener("click", stopCamera);
  $("tentCards").addEventListener("click", onSulfurClick);
  $("tentCards").addEventListener("input", onSulfurInput);
  $("tentCards").addEventListener("change", onSulfurInput);
  $("tentSettings").addEventListener("submit", saveTent);
  Store.onChange(() => renderSulfur());
  // A browser refuses to play sound until the page has been touched. Make
  // the audio context on the first touch, so the alarm can sound later.
  document.addEventListener("pointerdown", () => {
    try {
      if (!Boord._audioCtx) Boord._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (Boord._audioCtx.state === "suspended") Boord._audioCtx.resume();
    } catch (_) { /* no audio on this device */ }
  }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  setInterval(tick, 1000);
}
