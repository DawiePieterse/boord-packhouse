// The Sulfur tent role: badge scan, one card per tent with its suggested
// time (suggest.js), countdowns, the home tile, the alarm, and Settings ->
// Tents and Sulfur.
//
// Runs live in Store (sync.js): made here, queued on the tablet, sent when
// the Wi-Fi allows. Every countdown is worked out on this tablet from the
// run's start time and Store.now(), so a dropout never stops a timer or its
// alarm. Uses $ and esc from app.js, which loads after this file.

// --------------------------------------------------------------------------
// Operator: who is working, from their Boord badge. Stamped on every run
// they start or end. Signed out after OPERATOR_IDLE_MS untouched on the
// sulfur screen, or OPERATOR_GRACE_MS after leaving it for Home - a quick
// look at the home screen must not mean scanning the badge again. "Not
// you?" signs out at once.
// --------------------------------------------------------------------------
const OPERATOR_IDLE_MS = 15 * 60 * 1000;
const OPERATOR_GRACE_MS = 10 * 60 * 1000;

const Operator = {
  current() {
    try {
      const o = JSON.parse(localStorage.getItem("ph_operator"));
      if (o && Date.now() < o.until) return o.worker;
    } catch (_) { /* none */ }
    return null;
  },
  set(worker, ms = OPERATOR_IDLE_MS) {
    localStorage.setItem("ph_operator", JSON.stringify({ worker, until: Date.now() + ms }));
  },
  touch() { const w = this.current(); if (w) this.set(w); },
  // Left for Home: still signed in for the grace period, never longer.
  leave() {
    try {
      const o = JSON.parse(localStorage.getItem("ph_operator"));
      if (o && Date.now() < o.until) this.set(o.worker, Math.min(o.until - Date.now(), OPERATOR_GRACE_MS));
    } catch (_) { /* none */ }
  },
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
      minutesTouched: false, // once the operator steps the time, the suggestion stops moving it
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
        <div data-suggestion class="mt-2 text-sm rounded-lg bg-sky-50 text-sky-900 p-2 hidden"></div>
        <div data-residue class="mt-2 text-sm rounded-lg p-2 border hidden"></div>
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
        ${r.estimated_ppm != null ? `<br>Est. aril SO₂ when started: ${esc(r.estimated_ppm)} ppm` : ""}
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

// The suggested time for a tent card's current inputs, or null until the
// tablet has the settings. Worked out here, from cached settings, weather and
// fruit sources, so it works with no Wi-Fi.
function suggestionFor(tent, d) {
  const settings = Store.sulfurSettings();
  if (!settings) return null;
  const source = findSource(d.source);
  const weather = Store.weather();
  const input = {
    baseMinutes: tent.default_minutes, grams: Number(d.grams), crates: Number(d.crates) || 0,
    crateKg: source ? source.crate_kg : null, variety: source ? source.variety : "",
    temp: weather ? weather.temp : null, humidity: weather ? weather.humidity : null,
  };
  return { input, result: suggestMinutes(input, settings) };
}

// The aril SO2 line: the estimate for the time and grams on the card now,
// against the EU limit. Says plainly when the anchor is still an assumption.
const RESIDUE_STYLE = {
  ok:   ["bg-green-50 text-green-900 border-green-200", "fa-circle-check"],
  warn: ["bg-amber-50 text-amber-900 border-amber-300", "fa-triangle-exclamation"],
  over: ["bg-red-50 text-red-800 border-red-300", "fa-circle-xmark"],
};

function showResidue(card, minutes, s) {
  const box = card.querySelector("[data-residue]");
  const settings = Store.sulfurSettings();
  const est = s && settings && settings.residue_ref_ppm ? estimateResidue(Number(minutes), s.result, settings) : null;
  box.classList.toggle("hidden", !est);
  if (!est) return;
  const [style, icon] = RESIDUE_STYLE[est.level];
  box.className = `mt-2 text-sm rounded-lg p-2 border ${style}`;
  box.innerHTML = `<div><i class="fa-solid ${icon}"></i> <b>Est. aril SO₂: ${est.ppm} ppm</b> · EU limit ${settings.residue_limit_ppm} ppm</div>
    <div class="text-xs opacity-80">${est.level === "over" ? "Over the EU limit - shorten the time or use less sulfur. "
      : est.level === "warn" ? "Close to the EU limit. " : ""}${settings.residue_calibrated
      ? "Estimate from the farm's lab result."
      : `Not calibrated: assumes ${settings.residue_ref_ppm} ppm at the reference load until a lab result is entered in Settings → Sulfur.`}</div>`;
}

// Updates each idle card's suggestion in place (never a rebuild, which would
// wipe what is being typed). Until the operator steps the time, the time
// follows the suggestion.
function refreshSuggestions() {
  document.querySelectorAll("#tentCards [data-tent]:not([data-running-card])").forEach((card) => {
    const tent = Store.tents().find((t) => t.id === Number(card.dataset.tent));
    const box = card.querySelector("[data-suggestion]");
    if (!tent || !box) return;
    const d = draftFor(tent);
    const s = suggestionFor(tent, d);
    box.classList.toggle("hidden", !s);
    if (!s) return;
    if (!d.minutesTouched) {
      d.minutes = s.result.minutes;
      card.querySelector("[data-minutes]").textContent = d.minutes;
    }
    const differs = Number(d.minutes) !== s.result.minutes;
    box.innerHTML = `<div class="flex items-center justify-between gap-2">
        <div><i class="fa-solid fa-calculator"></i> <b>Suggested: ${s.result.minutes} min</b></div>
        ${differs ? `<button type="button" data-use-suggestion class="text-xs underline">Use ${s.result.minutes} min</button>` : ""}
      </div>
      <div class="text-xs opacity-80">${esc(describeSuggestion(tent.default_minutes, s.result))}${
        Store.weather() ? "" : " · no recent weather"}${findSource(d.source) ? "" : " · choose the fruit for its weight and variety"}</div>`;
    showResidue(card, d.minutes, s);
  });
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
  refreshSuggestions();
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
  const s = suggestionFor(tent, d);
  await Store.saveRun({
    uuid: Boord.uuid(), tent_id: tent.id, tent_name: tent.name,
    grams, minutes, crates,
    block_id: source.block_id ?? null, block_name: source.block_name || "", variety: source.variety || "",
    supplier_id: source.supplier_id ?? null, supplier_name: source.supplier_name || "",
    started_at: new Date(Store.now()).toISOString(), started_by: op.id, started_by_name: op.name,
    ended_at: null, ended_by: "", ended_by_name: "",
    // Kept beside the minutes chosen, to tune Settings -> Sulfur later.
    suggested_minutes: s ? s.result.minutes : null, fruit_kg: s ? s.result.fruitKg : null,
    estimated_ppm: s && Store.sulfurSettings() ? (estimateResidue(minutes, s.result, Store.sulfurSettings()) || {}).ppm ?? null : null,
    suggestion_temp: s ? s.input.temp : null, suggestion_humidity: s ? s.input.humidity : null,
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
  const tent = card && Store.tents().find((t) => t.id === Number(card.dataset.tent));
  if (tent && field) {
    draftFor(tent)[field] = ev.target.value;
    refreshSuggestions();
  }
}

function onSulfurClick(ev) {
  Operator.touch();
  const card = ev.target.closest("[data-tent]");
  const step = ev.target.closest("[data-step]");
  if (step && card) {
    const d = draftFor(Store.tents().find((t) => t.id === Number(card.dataset.tent)));
    d.minutes = Math.min(600, Math.max(5, Number(d.minutes) + Number(step.dataset.step)));
    d.minutesTouched = true;
    card.querySelector("[data-minutes]").textContent = d.minutes;
    refreshSuggestions();
    return;
  }
  if (ev.target.closest("[data-use-suggestion]") && card) {
    drafts[Number(card.dataset.tent)].minutesTouched = false;
    refreshSuggestions();
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
      ? `<div class="text-sm font-semibold text-green-700">${esc(r.tent_name)}: ${Math.ceil(left / 60000)} min left</div>`
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

// --------------------------------------------------------------------------
// Settings -> Sulfur: the numbers behind the suggested time.
// --------------------------------------------------------------------------
const SULFUR_FIELDS = [
  ["Reference conditions - a tent's default time applies to exactly these", null],
  ["ref_grams", "Sulfur (g)"], ["ref_crates", "Crates"], ["ref_crate_kg", "Crate weight (kg)"],
  ["ref_temp", "Temperature (°C)"], ["ref_humidity", "Humidity (%)"],
  ["Weather", null],
  ["temp_pct_per_deg", "% shorter per °C hotter"], ["humidity_pct_per_pct", "% longer per % more humid"],
  ["Limits", null],
  ["min_minutes", "Shortest (min)"], ["max_minutes", "Longest (min)"], ["round_to", "Round to (min)"],
  ["Aril SO₂ - the estimate is this residue at the reference load, scaled by time and dose. It does not allow for the acid dip, ripeness or holding fruit overnight, which all raise residue.", null],
  ["residue_ref_ppm", "Residue at reference (ppm)"], ["residue_limit_ppm", "EU limit (ppm)"], ["residue_warn_ppm", "Warn from (ppm)"],
];

async function loadSulfurSettings() {
  let data;
  try {
    data = await Boord.api("/api/settings/sulfur");
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    else $("sulfurSettingsForm").innerHTML = `<div class="text-sm text-slate-500">These can only be changed while the server can be reached.</div>`;
    return;
  }
  const s = data.settings;
  const factors = JSON.parse(s.variety_factors || "{}");
  const varieties = [...new Set([...data.varieties, ...Object.keys(factors)])];
  let html = "";
  let open = false;
  for (const [key, label] of SULFUR_FIELDS) {
    if (label === null) {
      if (open) html += `</div></div>`;
      html += `<div class="bg-white rounded-2xl shadow p-4"><div class="font-semibold mb-2">${esc(key)}</div><div class="grid grid-cols-2 md:grid-cols-3 gap-2">`;
      open = true;
    } else {
      html += `<label class="block"><span class="text-xs text-slate-500">${esc(label)}</span>
        <input name="${key}" type="number" step="any" inputmode="decimal" value="${esc(s[key])}" class="w-full border border-slate-300 rounded-lg p-2"></label>`;
    }
  }
  // The last group is Aril SO2: its lab-result tick goes under its numbers.
  html += `</div>
      <label class="flex items-start gap-2 text-sm mt-3">
        <input name="residue_calibrated" type="checkbox"${s.residue_calibrated ? " checked" : ""} class="w-5 h-5 mt-0.5">
        <span>The residue at reference is a <b>lab result</b> (Monier-Williams) from a run at the reference load, not an assumption</span></label>
    </div>
    <div class="bg-white rounded-2xl shadow p-4">
      <div class="font-semibold">Varieties</div>
      <div class="text-xs text-slate-500 mb-2">Times the time by this: 1.0 means no change, 0.9 is 10% shorter. From the blocks in Boord.</div>
      <div class="grid grid-cols-2 gap-2">${varieties.map((v) => `
        <label class="block"><span class="text-xs text-slate-500">${esc(v)}</span>
          <input data-variety="${esc(v)}" type="number" step="0.05" min="0.05" inputmode="decimal" value="${esc(factors[v] ?? 1)}"
                 class="w-full border border-slate-300 rounded-lg p-2"></label>`).join("") || `<div class="text-sm text-slate-400">No varieties on Boord's blocks yet.</div>`}
      </div>
    </div>
    <button class="w-full boord-btn-primary rounded-lg py-3 font-semibold">Save</button>`;
  $("sulfurSettingsForm").innerHTML = html;
}

async function saveSulfurSettings(ev) {
  ev.preventDefault();
  const form = $("sulfurSettingsForm");
  const body = { variety_factors: {} };
  for (const [key, label] of SULFUR_FIELDS) if (label !== null) body[key] = Number(form.elements[key].value);
  body.residue_calibrated = form.elements.residue_calibrated.checked;
  form.querySelectorAll("[data-variety]").forEach((el) => { body.variety_factors[el.dataset.variety] = Number(el.value); });
  try {
    await Boord.api("/api/settings/sulfur", { method: "PUT", body });
    Boord.toast("Sulfur settings saved");
    Store.syncNow(); // the tablets pick them up on their next sync
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
  Store.onChange(() => { renderSulfur(); refreshSuggestions(); });
  $("sulfurSettingsForm").addEventListener("submit", saveSulfurSettings);
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
