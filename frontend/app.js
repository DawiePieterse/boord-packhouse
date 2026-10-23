// Boord Packhouse - the home screen of big icons, one per role. Any tablet
// can open any role; tapping one opens it full screen, and Home in the
// bottom menu always comes back. Settings, also in the bottom menu, asks for
// the 4-digit PIN and has a bottom menu of its own. The screen is in the URL
// hash (#sulfur, #settings/backup), so the browser's own back button works
// too.
//
// Sulfur tent is built (sulfur.js, with its offline sync in sync.js); the
// other roles are placeholders until their stage of Boord_Packhouse_App_Plan.md.

const $ = (id) => document.getElementById(id);
const esc = (v) => Boord.escapeHtml(v);

// The plan's home-screen order.
const MODULES = [
  { id: "sulfur",   name: "Sulfur tent",         icon: "fa-tent",                     blurb: "Load a run, dose, countdown and overrun alarm.", built: true },
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
      ${m.built ? `<div id="tileStatus-${m.id}" class="mt-1"></div>` : `<div class="text-xs text-slate-400 mt-1">Coming soon</div>`}
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
  idleTimer = setTimeout(() => { if (location.hash.startsWith("#settings")) location.hash = ""; }, SETTINGS_IDLE_MS);
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
// Settings pages, one button each in the settings bottom menu. To add one:
// an entry here and a <div data-settings-page="<id>"> in index.html. `load`
// runs each time the page opens.
// --------------------------------------------------------------------------
const SETTINGS_PAGES = [
  { id: "packhouse", name: "Packhouse", icon: "fa-sliders" },
  { id: "tents",     name: "Tents",     icon: "fa-tent",       load: loadTentSettings },
  { id: "backup",    name: "Backup",    icon: "fa-database",   load: loadBackupsList },
  { id: "pin",       name: "PIN",       icon: "fa-key" },
];

function renderSettingsNav() {
  const nav = $("settingsNav");
  nav.style.gridTemplateColumns = `repeat(${SETTINGS_PAGES.length + 1}, minmax(0, 1fr))`;
  nav.innerHTML = `<a href="#" class="py-2 text-center text-sm"><i class="fa-solid fa-house text-2xl block"></i>Home</a>`
    + SETTINGS_PAGES.map((p) => `<a href="#settings/${p.id}" data-settings-nav="${p.id}" class="py-2 text-center text-sm">`
      + `<i class="fa-solid ${p.icon} text-2xl block"></i>${esc(p.name)}</a>`).join("");
}

// --------------------------------------------------------------------------
// Which screen. The hash decides: "" home, #<module>, #settings[/<page>].
// --------------------------------------------------------------------------
function show() {
  const hash = location.hash;
  const inSettings = hash === "#settings" || hash.startsWith("#settings/");
  if (!inSettings) lockSettings();
  const m = MODULES.find((x) => `#${x.id}` === hash);
  // Home ends the operator's turn: the next role needs the next badge.
  if (!hash || hash === "#") Operator.clear();
  const view = inSettings ? (unlocked ? "settings" : "pin")
    : m && m.id === "sulfur" ? (Operator.current() ? "sulfur" : "scan")
    : m ? "module" : "home";
  for (const id of ["home", "module", "scan", "sulfur", "pin", "settings"]) $(id).classList.toggle("hidden", id !== view);
  // The settings menu replaces the main one only once the PIN is in; the
  // PIN pad keeps the main menu so Home is one tap away.
  $("mainNav").classList.toggle("hidden", view === "settings");
  $("settingsNav").classList.toggle("hidden", view !== "settings");

  const page = SETTINGS_PAGES.find((p) => hash === `#settings/${p.id}`) || SETTINGS_PAGES[0];
  $("title").textContent = m ? m.name : view === "settings" ? `Settings · ${page.name}` : inSettings ? "Settings" : "Boord Packhouse";
  if (m) {
    $("moduleIcon").className = `fa-solid ${m.icon} text-6xl`;
    $("moduleName").textContent = m.name;
    $("moduleBlurb").textContent = m.blurb;
  }
  if (view === "pin") { pinEntry = ""; $("pinError").textContent = ""; renderPinDots(); }
  if (view !== "scan") stopCamera();
  if (view === "scan") $("scanMsg").textContent = "";
  if (view === "sulfur") renderSulfur(true);
  if (view === "settings") {
    touchSettings();
    document.querySelectorAll("[data-settings-page]").forEach((el) =>
      el.classList.toggle("hidden", el.dataset.settingsPage !== page.id));
    document.querySelectorAll("[data-settings-nav]").forEach((a) =>
      a.classList.toggle("tab-active", a.dataset.settingsNav === page.id));
    if (page.load) page.load();
  }
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("tab-active", a.dataset.nav === (inSettings ? "settings" : "home")));
  window.scrollTo(0, 0);
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
  updateWeather();
  setInterval(updateWeather, WEATHER_INTERVAL_MS);
  renderHome();
  renderPinPad();
  renderSettingsNav();
  initSulfur();
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
  Store.start();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
});
