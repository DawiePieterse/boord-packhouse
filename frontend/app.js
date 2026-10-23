// Boord Packhouse - the home screen of big icons, one per role. Any tablet
// can open any role; tapping one opens it full screen, and the Home button
// always comes back. The role is in the URL hash (#sulfur), so the
// browser's own back button works too.
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

function show() {
  const m = MODULES.find((x) => `#${x.id}` === location.hash);
  $("home").classList.toggle("hidden", !!m);
  $("module").classList.toggle("hidden", !m);
  $("homeBtn").classList.toggle("hidden", !m);
  $("title").textContent = m ? m.name : "Boord Packhouse";
  if (m) {
    $("moduleIcon").className = `fa-solid ${m.icon} text-6xl`;
    $("moduleName").textContent = m.name;
    $("moduleBlurb").textContent = m.blurb;
  }
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
  $("homeBtn").onclick = () => { location.hash = ""; };
  window.addEventListener("hashchange", show);
  show();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
});
