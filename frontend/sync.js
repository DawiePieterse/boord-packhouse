// Keeping the tablet working through patchy Wi-Fi.
//
// - What the screens need is cached in localStorage and refreshed whenever
//   the server answers: Boord's workers (badge scan), tents, fruit sources
//   and the server's list of sulfur runs.
// - Runs made on this tablet go to the IndexedDB outbox (idb.js) and are
//   sent by syncNow() every SYNC_EVERY_MS, and at once after any change.
// - The tablet's clock is corrected from the server's (server_now in every
//   sulfur response): run start times are tablet times, and a tablet that is
//   minutes out would skew the timers on every other tablet. Store.now() is
//   the corrected clock - use it, never Date.now(), for anything a run holds.
// - The header pill says where it stands, in Field's colours.

const Store = (() => {
  const SYNC_EVERY_MS = 10 * 1000;
  const WORKERS_EVERY_MS = 15 * 60 * 1000;
  const listeners = [];
  let busy = false;
  let lastWorkers = 0;
  let localRuns = new Map(); // uuid -> run, this tablet's outbox (synced or not)

  function cached(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  }
  function keep(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* full: keep the old copy */ }
  }

  function device() {
    let id = localStorage.getItem("ph_device");
    if (!id) { id = `tablet-${Boord.uuid().slice(0, 6)}`; localStorage.setItem("ph_device", id); }
    return id;
  }

  // The server's clock minus this tablet's, from the midpoint of a request.
  function learnClock(serverNowIso, sentAt) {
    const server = Date.parse(serverNowIso);
    if (!server) return;
    keep("ph_clock_offset", Math.round(server - (sentAt + Date.now()) / 2));
  }
  const now = () => Date.now() + (cached("ph_clock_offset", 0) || 0);

  function setPill(state, text) {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("bg-white/20", "bg-green-600", "bg-amber-400", "text-slate-900", "bg-red-600");
    if (state === "synced") el.classList.add("bg-green-600");
    else if (state === "pending") el.classList.add("bg-amber-400", "text-slate-900");
    else if (state === "offline") el.classList.add("bg-red-600");
    else el.classList.add("bg-white/20");
  }

  function changed() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  async function loadLocal() {
    try { localRuns = new Map((await IDB.all()).map((r) => [r.uuid, r])); } catch (e) { /* private mode: server list only */ }
  }

  // A run as the server wants it: no outbox bookkeeping.
  function wire(r) {
    const { synced, error, ...rest } = r;
    return rest;
  }

  async function syncNow() {
    if (busy) return;
    busy = true;
    let pending = [];
    try {
      pending = await IDB.pending().catch(() => []);
      if (!navigator.onLine) throw Object.assign(new Error("offline"), { offline: true });
      if (pending.length) {
        setPill("pending", `Syncing ${pending.length}...`);
        const sentAt = Date.now();
        const out = await Boord.api("/api/sulfur/sync", { method: "POST", body: { device: device(), runs: pending.map(wire) } });
        learnClock(out.server_now, sentAt);
        const synced = new Set(out.synced);
        await IDB.markSynced(pending.filter((r) => synced.has(r.uuid)));
        for (const bad of out.rejected) {
          // Refused for good (a deleted tent, a bad value): stop resending it
          // and say so, rather than pinning the pill on amber forever.
          console.warn("Run refused by the server:", bad);
          Boord.toast(`A run was refused by the server: ${bad.error}`);
          await IDB.markSynced(pending.filter((r) => r.uuid === bad.uuid), bad.error);
        }
        await IDB.prune().catch(() => {});
        await loadLocal();
      }
      const sentAt = Date.now();
      const runs = await Boord.api("/api/sulfur/runs");
      learnClock(runs.server_now, sentAt);
      keep("ph_server_runs", runs.runs);
      keep("ph_tents", await Boord.api("/api/tents"));
      keep("ph_sources", await Boord.api("/api/fruit-sources"));
      if (Date.now() - lastWorkers > WORKERS_EVERY_MS) await refreshWorkers();
      const left = (await IDB.pending().catch(() => [])).length;
      setPill(left ? "pending" : "synced", left ? `Syncing ${left}...` : "Online - synced");
    } catch (e) {
      if (e.offline || Boord.isNetworkError(e)) {
        Boord.setOffline(true);
        setPill("offline", pending.length ? `Offline - ${pending.length} pending` : "Offline");
      } else {
        setPill("pending", "Online - sync failed, retrying");
        console.warn("Sync failed:", e);
      }
    } finally {
      busy = false;
      changed();
    }
  }

  async function refreshWorkers() {
    keep("ph_workers", await Boord.api("/api/workers"));
    lastWorkers = Date.now();
  }

  return {
    now,
    device,
    onChange: (fn) => listeners.push(fn),
    workers: () => cached("ph_workers", []),
    tents: () => cached("ph_tents", []),
    sources: () => cached("ph_sources", []),
    refreshWorkers: () => refreshWorkers().catch(() => {}),
    syncNow,

    // Every run this tablet knows of: the server's list, with this tablet's
    // own copy winning where it is newer (not sent yet, or ended here).
    runs() {
      const all = new Map(cached("ph_server_runs", []).map((r) => [r.uuid, r]));
      for (const r of localRuns.values()) {
        const server = all.get(r.uuid);
        if (!server || (!server.ended_at && r.ended_at)) all.set(r.uuid, r);
      }
      return [...all.values()];
    },

    // Start or end a run: into the outbox first, then try to send it.
    async saveRun(r) {
      const row = { ...r, synced: 0, error: "" };
      localRuns.set(row.uuid, row);
      await IDB.put(row);
      changed();
      syncNow();
    },

    async start() {
      await loadLocal();
      changed();
      syncNow();
      setInterval(syncNow, SYNC_EVERY_MS);
      window.addEventListener("online", syncNow);
      window.addEventListener("offline", () => syncNow());
    },
  };
})();
