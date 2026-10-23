// Boord Packhouse - the home screen of big icons, one per role. Any tablet
// can open any role; tapping one opens it full screen, and Home in the
// bottom menu always comes back. Settings, also in the bottom menu, asks for
// the 4-digit PIN. The screen is in the URL hash (#sulfur, #settings), so
// the browser's own back button works too.
//
// Every role is a placeholder for now. Each one is built in its own stage
// of Boord_Packhouse_App_Plan.md ("Build stages").

const $ = (id) => document.getElementById(id);
const esc = (v) => Boord.escapeHtml(v);

// The plan's home-screen order.
const MODULES = [
  { id: "sulfur",   name: "Sulfur tent",         icon: "fa-tent",                     blurb: "Load a run, dose, countdown and overrun alarm." },
  { id: "acid",     name: "Acid bath",           icon: "fa-flask",                    blurb: "Batches, dip and drying timers, chemical changes." },
  { id: "prepack",  name: "Pre-pack",            icon: "fa-box-open",                 blurb: "Punnets into cartons onto pre-pack pallets." },
  { id: "lines",    name: "Lines",               icon: "fa-arrows-split-up-and-left", blurb: "Grading split by route, cartons and pallets." },
  { id: "coldstore", name: "Cold store & PPECB", icon: "fa-snowflake",                blurb: "Pallets in and out, PPECB inspections." },
  { id: "dispatch", name: "Dispatch",            icon: "fa-truck",                    blurb: "Build a load, release checks, load sheet." },
];

function renderHome() {
  $("home").innerHTML = MODULES.map((m) => `
    <a href="#${m.id}" class="bg-white rounded-2xl shadow p-4 flex flex-col items-center justify-center text-center min-h-[10rem] md:min-h-[12rem] active:bg-slate-50">
      <i class="fa-solid ${m.icon} text-5xl md:text-6xl" style="color: var(--boord-blue)"></i>
      <div class="font-bold text-lg md:text-xl mt-3 leading-tight">${esc(m.name)}</div>
      <div class="text-xs text-slate-400 mt-1">Coming soon</div>
    </a>`).join("");
}

// --------------------------------------------------------------------------
// Settings PIN. The tablets are shared, so Settings is signed out the moment
// it is left (or sits untouched for SETTINGS_IDLE_MS) - the next person to
// tap Settings types the PIN again. The server enforces it either way:
// every settings endpoint answers 401 without the cookie (admin_auth.py).
// --------------------------------------------------------------------------
const PIN_LENGTH = 4;
const SETTINGS_IDLE_MS = 5 * 60 * 1000;
let unlocked = false;
let pinEntry = "";
let idleTimer = null;

function renderPinPad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  $("pinPad").innerHTML = keys.map((k) => k === ""
    ? "<div></div>"
    : `<button type="button" data-key="${k}" class="keypad-btn text-2xl py-4 font-semibold">${
        k === "del" ? '<i class="fa-solid fa-delete-left"></i>' : k}</button>`).join("");
  $("pinPad").onclick = (ev) => {
    const btn = ev.target.closest("button[data-key]");
    if (btn) pressKey(btn.dataset.key);
  };
}

function renderPinDots() {
  $("pinDots").innerHTML = Array.from({ length: PIN_LENGTH }, (_, i) =>
    `<span class="w-4 h-4 rounded-full border-2" style="border-color: var(--boord-blue);${
      i < pinEntry.length ? " background: var(--boord-blue);" : ""}"></span>`).join("");
}

async function pressKey(key) {
  if (key === "del") pinEntry = pinEntry.slice(0, -1);
  else if (pinEntry.length < PIN_LENGTH) pinEntry += key;
  $("pinError").textContent = "";
  renderPinDots();
  if (pinEntry.length < PIN_LENGTH) return;
  const pin = pinEntry;
  pinEntry = "";
  try {
    await Boord.api("/api/admin/login", { method: "POST", body: { pin } });
    unlocked = true;
    show();
  } catch (e) {
    renderPinDots();
    $("pinError").textContent = Boord.errorDetail(e, "No connection to the server");
  }
}

function lockSettings() {
  clearTimeout(idleTimer);
  if (!unlocked) return;
  unlocked = false;
  Boord.api("/api/admin/logout", { method: "POST" }).catch(() => {});
}

function touchSettings() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (location.hash === "#settings") location.hash = ""; }, SETTINGS_IDLE_MS);
}

async function changePin(ev) {
  ev.preventDefault();
  try {
    await Boord.api("/api/admin/pin", { method: "POST", body: { current: $("pinCurrent").value, new: $("pinNew").value } });
    $("pinCurrent").value = $("pinNew").value = "";
    Boord.toast("PIN changed - other tablets need the new one");
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

// Backups card in Settings - Boord Admin's, trimmed (backend/backup.py).
function fmtSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function loadBackupsList() {
  let backups;
  try {
    backups = await Boord.api("/api/backups");
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); }
    return;
  }
  $("backupsTable").innerHTML = backups.map((b) => `
    <tr class="border-b">
      <td class="p-2">${esc(Boord.fmtDateTime(b.created_at))}</td>
      <td class="p-2">${fmtSize(b.size_bytes)}</td>
      <td class="p-2 text-right"><a href="#" class="text-blue-700 text-xs" data-download="${esc(b.filename)}">Download</a></td>
    </tr>`).join("") || `<tr><td class="p-2 text-slate-400" colspan="3">No backups yet</td></tr>`;
}

async function downloadBackup(ev) {
  const a = ev.target.closest("[data-download]");
  if (!a) return;
  ev.preventDefault();
  try {
    const blob = await Boord.api(`/api/backups/${encodeURIComponent(a.dataset.download)}/download`, { timeoutMs: Boord.UPLOAD_TIMEOUT_MS });
    Boord.downloadBlob(blob, a.dataset.download);
  } catch (e) {
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  }
}

async function runBackupNow() {
  $("runBackupBtn").disabled = true;
  try {
    await Boord.api("/api/backups", { method: "POST", timeoutMs: Boord.UPLOAD_TIMEOUT_MS });
    Boord.toast("Backup created");
    await loadBackupsList();
  } catch (e) {
    if (e.status === 401) { unlocked = false; show(); return; }
    Boord.toast(Boord.errorDetail(e, "No connection to the server"));
  } finally {
    $("runBackupBtn").disabled = false;
  }
}

// --------------------------------------------------------------------------
// Which screen. The hash decides: "" home, #<module>, #settings.
// --------------------------------------------------------------------------
function show() {
  const hash = location.hash;
  if (hash !== "#settings") lockSettings();
  const m = MODULES.find((x) => `#${x.id}` === hash);
  const view = hash === "#settings" ? (unlocked ? "settings" : "pin") : m ? "module" : "home";
  for (const id of ["home", "module", "pin", "settings"]) $(id).classList.toggle("hidden", id !== view);
  $("title").textContent = m ? m.name : hash === "#settings" ? "Settings" : "Boord Packhouse";
  if (m) {
    $("moduleIcon").className = `fa-solid ${m.icon} text-6xl`;
    $("moduleName").textContent = m.name;
    $("moduleBlurb").textContent = m.blurb;
  }
  if (view === "pin") { pinEntry = ""; $("pinError").textContent = ""; renderPinDots(); }
  if (view === "settings") { touchSettings(); loadBackupsList(); }
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("tab-active", a.dataset.nav === (hash === "#settings" ? "settings" : "home")));
  window.scrollTo(0, 0);
}

// Header pill, the same colours as Field's so it reads the same at arm's
// length: green = online and synced, amber = pending, red = offline.
function setSyncStatus(state, text) {
  const el = $("syncStatus");
  el.textContent = text;
  el.classList.remove("bg-white/20", "bg-green-600", "bg-amber-400", "text-slate-900", "bg-red-600");
  if (state === "synced") el.classList.add("bg-green-600");
  else if (state === "pending") el.classList.add("bg-amber-400", "text-slate-900");
  else if (state === "offline") el.classList.add("bg-red-600");
  else el.classList.add("bg-white/20");
}

// Nothing is queued on the tablet yet, so "synced" just means the server
// answered. ponytail: add the outbox count ("Syncing 3...", "Offline - 3
// pending") when the first module gets an IndexedDB outbox, as Field does.
const PROBE_INTERVAL_MS = 15000;
async function checkServer() {
  try {
    await Boord.api("/api/version", { timeoutMs: 5000 });
    setSyncStatus("synced", "Online - synced");
  } catch (e) {
    setSyncStatus("offline", "Offline");
  }
}

// Same strip as Boord Admin's header. Boord owns the weather source; this
// server passes it through (backend/routers/weather.py).
const WEATHER_INTERVAL_MS = 10 * 60 * 1000;
async function updateWeather() {
  try {
    const w = await Boord.api("/api/weather/current");
    if (w && w.no_location) {
      $("headerWeather").innerHTML = `<i class="fa-solid fa-location-dot"></i> Set pack house location in Boord Settings`;
    } else if (w && w.temp != null) {
      $("headerWeather").innerHTML = `<i class="fa-solid ${Boord.weatherIcon(w.condition)}"></i> ${Math.round(w.temp)}°C`
        + `${w.condition ? ` · ${esc(w.condition)}` : ""}${w.humidity != null ? ` · ${Math.round(w.humidity)}% humidity` : ""}`;
    }
  } catch (e) {
    // weather is a nice-to-have - keep the last reading, never error the header
  }
}

Boord.boot(() => {
  $("appVersion").textContent = `v${Boord.VERSION}`;
  Boord.offlineBanner("No connection to the server");
  checkServer();
  setInterval(checkServer, PROBE_INTERVAL_MS);
  window.addEventListener("online", checkServer);
  window.addEventListener("offline", () => setSyncStatus("offline", "Offline"));
  updateWeather();
  setInterval(updateWeather, WEATHER_INTERVAL_MS);
  renderHome();
  renderPinPad();
  // Never inherit a sign-in: a tablet reloaded (or an installed app reopened)
  // may still hold the session cookie, and the next person must type the PIN.
  Boord.api("/api/admin/logout", { method: "POST" }).catch(() => {});
  $("pinChangeForm").addEventListener("submit", changePin);
  $("runBackupBtn").addEventListener("click", runBackupNow);
  $("backupsTable").addEventListener("click", downloadBackup);
  $("settings").addEventListener("pointerdown", touchSettings);
  $("settings").addEventListener("input", touchSettings);
  window.addEventListener("hashchange", show);
  show();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
});
