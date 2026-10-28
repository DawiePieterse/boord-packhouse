// Boord Packhouse - the home screen of big icons, one per role. Any tablet
// can open any role; tapping one opens it full screen, and Pallets and
// Delivery in the bottom menu switch between those two. Settings, also in the bottom menu, asks for
// the 4-digit PIN and has a bottom menu of its own. The screen is in the URL
// hash (#sulfur, #settings/backup), so the browser's own back button works
// too.
//
// Sulfur tent (sulfur.js), Acid bath (acid.js), Pallet Stack (consignment.js)
// and Delivery Note (deliverynote.js) are built, with their offline sync in
// sync.js; the other roles are placeholders until their stage of Boord_Packhouse_App_Plan.md.

const $ = (id) => document.getElementById(id);
const esc = (v) => Boord.escapeHtml(v);

const PALLET_BOXES = `<svg viewBox="0 0 64 64" class="w-[1.15em] h-[1em] inline-block" fill="currentColor" aria-hidden="true"><rect x="10" y="8" width="20" height="14" rx="1.5"/><rect x="34" y="8" width="20" height="14" rx="1.5"/><rect x="4" y="25" width="17" height="14" rx="1.5"/><rect x="23.5" y="25" width="17" height="14" rx="1.5"/><rect x="43" y="25" width="17" height="14" rx="1.5"/><rect x="2" y="42" width="60" height="6" rx="1"/><rect x="6" y="50" width="10" height="7" rx="1"/><rect x="27" y="50" width="10" height="7" rx="1"/><rect x="48" y="50" width="10" height="7" rx="1"/></svg>`;

// A litchi: a bumpy round fruit on a stem with a leaf.
const LITCHI = `<svg viewBox="0 0 64 64" class="w-[1em] h-[1em] inline-block" fill="currentColor" aria-hidden="true"><path d="M32 18 C33 12 35 8 38 5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M37 7 C44 2 54 3 58 8 C51 13 42 13 37 7 Z"/><circle cx="32" cy="39" r="22"/><g fill="#fff" fill-opacity=".35"><circle cx="22" cy="30" r="3"/><circle cx="32" cy="26" r="3"/><circle cx="42" cy="30" r="3"/><circle cx="17" cy="40" r="3"/><circle cx="27" cy="37" r="3"/><circle cx="37" cy="37" r="3"/><circle cx="47" cy="40" r="3"/><circle cx="22" cy="49" r="3"/><circle cx="32" cy="47" r="3"/><circle cx="42" cy="49" r="3"/><circle cx="32" cy="56" r="2.5"/></g></svg>`;

// The plan's home-screen order. parked: built, but kept off the home screen
// and the settings menu until the farm takes it up again (its code and
// #<id> address still work); remove the flag to bring it back.
const MODULES = [
  { id: "sulfur",   name: "Sulfur tent",         icon: "fa-tent",                     blurb: "Load a run, dose, countdown and overrun alarm.", built: true, parked: true },
  { id: "acid",     name: "Acid bath",           icon: "fa-flask",                    blurb: "Batches, dip and drying timers, chemical changes.", built: true, parked: true },
  { id: "palletstack", name: "Pallet Stack",   icon: "",                  iconHtml: PALLET_BOXES, blurb: "Pallets and cartons grouped into a pallet stack.", built: true },
  { id: "deliverynote", name: "Delivery Note",   icon: "fa-file-lines",               blurb: "Delivery note for a load leaving the farm.", built: true },
  { id: "juice",    name: "Juice",               icon: "",                  iconHtml: LITCHI, blurb: "Juice bins weighed empty and full, for the delivery note.", built: true },
];

function renderHome() {
  $("home").innerHTML = MODULES.filter((m) => !m.parked).map((m) => `
    <a href="#${m.id}" class="bg-white rounded-2xl shadow p-4 flex flex-col items-center justify-center text-center min-h-[10rem] md:min-h-[12rem] active:bg-slate-50">
      ${m.iconHtml ? `<span class="text-5xl md:text-6xl leading-none" style="color: var(--boord-blue)">${m.iconHtml}</span>` : `<i class="fa-solid ${m.icon} text-5xl md:text-6xl" style="color: var(--boord-blue)"></i>`}
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
// The settings PIN on a floor screen, checked by the server with the same
// lockout but no Settings cookie (so it needs the server): opening Pallet
// Stack or Delivery Note without a badge (PIN_OPENS; the operator is then
// just "PIN"), and deleting a delivery note. askPin shows the keypad, and
// `then` runs once the PIN is right; Cancel or leaving the screen drops it.
const PIN_OPENS = ["palletstack", "deliverynote", "juice"];
let pinAsk = null; // { title, then }
function askPin(title, then) {
  pinAsk = { title, then };
  show();
}

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
    if (pinAsk) {
      await Boord.api("/api/admin/check", { method: "POST", body: { pin } });
      const then = pinAsk.then;
      pinAsk = null;
      await then();
      show();
      return;
    }
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
  { id: "sulfur",    name: "Sulfur",    icon: "fa-tent",       parked: true, load: () => { loadTentSettings(); loadSulfurSettings(); loadSulfurReport(); } },
  { id: "acid",      name: "Acid",      icon: "fa-flask",      parked: true, load: loadBathSettings },
  { id: "palletstack", name: "Pallet Stack", icon: "", iconHtml: PALLET_BOXES, load: loadConsignmentSettings },
  { id: "deliverynote", name: "Delivery Note", icon: "fa-file-lines", load: loadDeliverySettings },
  { id: "setup",     name: "Setup",     icon: "fa-screwdriver-wrench", load: loadBackupsList },
];

function renderSettingsNav() {
  const nav = $("settingsNav");
  const pages = SETTINGS_PAGES.filter((p) => !p.parked);
  nav.style.gridTemplateColumns = `repeat(${pages.length + 1}, minmax(0, 1fr))`;
  nav.innerHTML = `<a href="#" class="py-2 text-center text-sm"><i class="fa-solid fa-house text-2xl block"></i>Home</a>`
    + pages.map((p) => `<a href="#settings/${p.id}" data-settings-nav="${p.id}" class="py-2 text-center text-[11px] sm:text-sm">`
      + (p.iconHtml ? `<span class="h-8 flex items-center justify-center text-[1.6rem]">${p.iconHtml}</span>` : `<i class="fa-solid ${p.icon} text-2xl block"></i>`)
      + `${esc(p.name)}</a>`).join("");
}

// Roles that open with a badge scan.
const BADGED = ["sulfur", "acid", "palletstack", "deliverynote", "juice"];
const onBadgedScreen = () => BADGED.some((id) => location.hash === `#${id}`);

// --------------------------------------------------------------------------
// Which screen. The hash decides: "" home, #<module>, #settings[/<page>].
// --------------------------------------------------------------------------
function show() {
  const hash = location.hash;
  const inSettings = hash === "#settings" || hash.startsWith("#settings/");
  if (!inSettings) lockSettings();
  const m = MODULES.find((x) => `#${x.id}` === hash);
  // Off a badge-scanned screen the operator stays signed in for a 10-minute
  // grace period (Operator.leave), so popping out to Home needs no rescan;
  // coming back counts as working again.
  if (!onBadgedScreen()) Operator.leave();
  else Operator.touch();
  const badged = m && BADGED.includes(m.id);
  if (!badged) pinAsk = null;
  const view = inSettings ? (unlocked ? "settings" : "pin")
    : badged ? (pinAsk ? "pin" : Operator.current() ? m.id : "scan")
    : m ? "module" : "home";
  for (const id of ["home", "module", "scan", "sulfur", "acid", "palletstack", "deliverynote", "juice", "pin", "settings"]) $(id).classList.toggle("hidden", id !== view);
  // The settings menu replaces the main one only once the PIN is in; the
  // PIN pad keeps the main menu.
  $("mainNav").classList.toggle("hidden", view === "settings");
  $("settingsNav").classList.toggle("hidden", view !== "settings");

  const page = SETTINGS_PAGES.find((p) => hash === `#settings/${p.id}`) || SETTINGS_PAGES.find((p) => !p.parked);
  $("title").textContent = m ? m.name : view === "settings" ? `Settings · ${page.name}` : inSettings ? "Settings" : "Boord Packhouse";
  if (m) {
    $("moduleIcon").className = m.iconHtml ? "text-6xl" : `fa-solid ${m.icon} text-6xl`;
    $("moduleIcon").innerHTML = m.iconHtml || "";
    $("moduleName").textContent = m.name;
    $("moduleBlurb").textContent = m.blurb;
  }
  if (view === "pin") $("pinTitle").textContent = pinAsk ? pinAsk.title : "Settings PIN";
  $("pinCancel").classList.toggle("hidden", !pinAsk);
  if (view === "scan") $("scanPinBtn").classList.toggle("hidden", !PIN_OPENS.includes(m.id));
  if (view === "pin") { pinEntry = ""; $("pinError").textContent = ""; renderPinDots(); }
  if (view !== "scan") stopCamera();
  if (view !== "palletstack") stopPalletScan();
  if (view !== "deliverynote") stopSealScan();
  if (view === "scan") $("scanMsg").textContent = "";
  if (view === "sulfur") renderSulfur(true);
  if (view === "acid") renderAcid(true);
  if (view === "palletstack") renderConsignment();
  if (view === "deliverynote") renderDeliveryNote();
  if (view === "juice") renderJuice();
  if (view === "settings") {
    touchSettings();
    document.querySelectorAll("[data-settings-page]").forEach((el) =>
      el.classList.toggle("hidden", el.dataset.settingsPage !== page.id));
    document.querySelectorAll("[data-settings-nav]").forEach((a) =>
      a.classList.toggle("tab-active", a.dataset.settingsNav === page.id));
    if (page.load) page.load();
  }
  // Pallets, Delivery and Juice grey out on their own screen; Settings lights up.
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const here = inSettings ? a.dataset.nav === "settings" : !!m && a.dataset.nav === m.id;
    a.classList.toggle("tab-active", here && a.dataset.nav === "settings");
    a.classList.toggle("opacity-40", here && a.dataset.nav !== "settings");
    a.classList.toggle("pointer-events-none", here && a.dataset.nav !== "settings");
  });
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
      Store.keepWeather(w); // the sulfur screen's suggested time uses it, offline too
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
  $("navPalletIcon").innerHTML = PALLET_BOXES;
  $("navJuiceIcon").innerHTML = LITCHI;
  initSulfur();
  initAcid();
  initConsignment();
  initDeliveryNote();
  initJuice();
  // Never inherit a sign-in: a tablet reloaded (or an installed app reopened)
  // may still hold the session cookie, and the next person must type the PIN.
  Boord.api("/api/admin/logout", { method: "POST" }).catch(() => {});
  $("scanPinBtn").addEventListener("click", () => askPin(`${$("title").textContent} PIN`, () => Operator.set({ id: "", name: "PIN" })));
  $("pinCancel").addEventListener("click", () => { pinAsk = null; show(); });
  $("pinChangeForm").addEventListener("submit", changePin);
  $("runBackupBtn").addEventListener("click", runBackupNow);
  $("backupsTable").addEventListener("click", downloadBackup);
  $("settings").addEventListener("pointerdown", touchSettings);
  $("settings").addEventListener("input", touchSettings);
  window.addEventListener("hashchange", show);
  // Any tap, key or scroll on a badge-scanned screen is working there: it
  // keeps the operator signed in, not only the buttons each screen handles.
  for (const type of ["pointerdown", "keydown", "scroll"]) {
    document.addEventListener(type, () => { if (onBadgedScreen()) Operator.touch(); }, { capture: true, passive: true });
  }
  show();
  Store.start();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
});
