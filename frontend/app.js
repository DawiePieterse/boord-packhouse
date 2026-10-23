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

Boord.boot(() => {
  $("appVersion").textContent = `v${Boord.VERSION}`;
  Boord.offlineBanner("No connection to the server");
  renderHome();
  $("homeBtn").onclick = () => { location.hash = ""; };
  window.addEventListener("hashchange", show);
  show();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
});
