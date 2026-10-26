// Keeping the tablet working through patchy Wi-Fi.
//
// - What the screens need is cached in localStorage and refreshed whenever
//   the server answers: Boord's workers (badge scan), tents, fruit sources,
//   the suggested-time settings, the weather, the server's sulfur runs, the
//   acid baths and their state, the consignments and the packs and markets,
//   and the delivery notes.
// - Records made on this tablet - sulfur runs, and acid batches, chemical
//   changes and checks (marked by `kind`) - go to the IndexedDB outbox
//   (idb.js) and are sent by syncNow() every SYNC_EVERY_MS, and at once after
//   any change, each to its own module's sync endpoint.
// - The tablet's clock is corrected from the server's (server_now in every
//   sulfur and acid response): run start times are tablet times, and a tablet that is
//   minutes out would skew the timers on every other tablet. Store.now() is
//   the corrected clock - use it, never Date.now(), for anything a run holds.
// - The header pill says where it stands, in Field's colours.

const Store = (() => {
  const SYNC_EVERY_MS = 10 * 1000;
  const WORKERS_EVERY_MS = 15 * 60 * 1000;
  const listeners = [];
  let busy = false;
  let lastWorkers = 0;
  let localRuns = new Map(); // uuid -> record, this tablet's outbox (synced or not)

  // Parsed once and kept in memory: the 1-second tick reads these many times
  // over, and re-parsing localStorage each time is what a slow tablet feels.
  // Only keep() writes them, so it refreshes the copy. Shared: never mutate.
  const memo = new Map();
  function cached(key, fallback) {
    if (!memo.has(key)) {
      let value = null;
      try { value = JSON.parse(localStorage.getItem(key)); } catch (_) { /* unreadable: the fallback */ }
      memo.set(key, value);
    }
    return memo.get(key) ?? fallback;
  }
  function keep(key, value) {
    memo.set(key, value);
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

  // A record as the server wants it: no outbox bookkeeping.
  function wire(r) {
    const { synced, error, kind, ...rest } = r;
    return rest;
  }
  // v0.14 queued acid batches ended on a second tablet with no kind; they have
  // dip_minutes, a sulfur run never does.
  const kindOf = (r) => r.kind || (r.dip_minutes != null ? "acid_batch" : "");
  const ofKind = (rows, kind) => rows.filter((r) => kindOf(r) === kind).map(wire);
  // Where each kind of outbox record is sent; sulfur runs have no kind.
  const OUTBOXES = [
    ["/api/sulfur/sync", (rows) => ({ runs: ofKind(rows, "") })],
    ["/api/acid/sync", (rows) => ({ batches: ofKind(rows, "acid_batch"), changes: ofKind(rows, "acid_change"),
                                    checks: ofKind(rows, "acid_check") })],
    ["/api/consignment/sync", (rows) => ({ consignments: ofKind(rows, "consignment"), pallets: ofKind(rows, "pallet") })],
    ["/api/deliverynote/sync", (rows) => ({ notes: ofKind(rows, "delivery_note") })],
  ];

  // The server's list with this tablet's own copies merged in, the local
  // copy winning where it has got further (not sent yet, or ended here).
  function merged(serverRows, kind) {
    // Tag server rows with their kind: one ended here is re-queued from this
    // copy, and without a kind it would go to the sulfur endpoint and fail.
    const all = new Map(serverRows.map((r) => [r.uuid, { ...r, kind }]));
    for (const r of localRuns.values()) {
      // A record the server refused is never shown: a refused batch would
      // otherwise sit "dipping" here, alarm and all, until it was pruned.
      if (kindOf(r) !== kind || r.error) continue;
      const server = all.get(r.uuid);
      if (!server || (!server.ended_at && r.ended_at) || (!server.dip_ended_at && r.dip_ended_at)) all.set(r.uuid, r);
    }
    return [...all.values()];
  }

  // Consignments and pallets are edited after they are sent, so unlike the
  // runs above the server's copy only wins where this phone has nothing
  // unsent: an unsent local copy goes over it. A refused one stays in sight
  // with its error (a pallet counted by hand must not vanish), to be fixed
  // and saved again.
  function liveMerged(serverRows, kind) {
    const all = new Map(serverRows.map((r) => [r.uuid, r]));
    for (const r of localRuns.values()) {
      if (kindOf(r) !== kind) continue;
      const server = all.get(r.uuid);
      if (!server) all.set(r.uuid, r);
      else if (!r.synced || r.error) all.set(r.uuid, { ...server, ...r });
    }
    return [...all.values()];
  }

  // One module's outbox to its own endpoint. Refused records are marked so
  // they stop being resent.
  async function sendOutbox(path, body, pending) {
    const sentAt = Date.now();
    const out = await Boord.api(path, { method: "POST", body: { device: device(), ...body } });
    learnClock(out.server_now, sentAt);
    const synced = new Set(out.synced);
    await IDB.markSynced(pending.filter((r) => synced.has(r.uuid)));
    for (const bad of out.rejected) {
      // Refused for good (a deleted tent, a bad value): stop resending it
      // and say so, rather than pinning the pill on amber forever.
      console.warn("Record refused by the server:", bad);
      Boord.toast(`A record was refused by the server: ${bad.error}`);
      await IDB.markSynced(pending.filter((r) => r.uuid === bad.uuid), bad.error);
    }
  }

  async function syncNow() {
    if (busy) return;
    busy = true;
    let pending = [];
    let failed = null; // a module's sync that errored, after the others were sent
    try {
      pending = await IDB.pending().catch(() => []);
      if (!navigator.onLine) throw Object.assign(new Error("offline"), { offline: true });
      if (pending.length) {
        setPill("pending", `Syncing ${pending.length}...`);
        for (const [path, bodyOf] of OUTBOXES) {
          const body = bodyOf(pending);
          if (!Object.values(body).some((rows) => rows.length)) continue;
          // Each module on its own: a sulfur endpoint that errors must not
          // hold the acid records back, or the other way round. A dropped
          // connection still stops the pass - the next one would fail too.
          try {
            await sendOutbox(path, body, pending);
          } catch (e) {
            if (Boord.isNetworkError(e)) throw e;
            failed = e;
          }
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
      keep("ph_sulfur_settings", await Boord.api("/api/sulfur/settings"));
      keep("ph_acid", await Boord.api("/api/acid/state"));
      keep("ph_baths", await Boord.api("/api/baths"));
      keep("ph_consignments", await Boord.api("/api/consignment/state"));
      keep("ph_packaging", await Boord.api("/api/packaging"));
      keep("ph_markets", await Boord.api("/api/markets"));
      keep("ph_suppliers", await Boord.api("/api/suppliers"));
      keep("ph_notes", await Boord.api("/api/deliverynote/state"));
      keep("ph_note_options", await Boord.api("/api/deliverynote/options"));
      if (Date.now() - lastWorkers > WORKERS_EVERY_MS) await refreshWorkers();
      if (failed) throw failed;
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
    sulfurSettings: () => cached("ph_sulfur_settings", null),
    // The header's last farm weather (app.js), if it is recent enough to
    // base a suggested time on.
    weather() {
      const w = cached("ph_weather", null);
      return w && Date.now() - w.at < 3 * 3600 * 1000 ? w : null;
    },
    keepWeather: (w) => keep("ph_weather", { temp: w.temp, humidity: w.humidity, at: Date.now() }),
    refreshWorkers: () => refreshWorkers().catch(() => {}),
    syncNow,

    // Every sulfur run this tablet knows of.
    runs: () => merged(cached("ph_server_runs", []), ""),
    baths: () => cached("ph_baths", []),
    // Acid batches, chemical changes and checks: the server's (acid.py's
    // /state) and this tablet's own.
    acidBatches: () => merged(cached("ph_acid", {}).batches || [], "acid_batch"),
    acidChanges: () => merged(cached("ph_acid", {}).changes || [], "acid_change"),
    acidChecks: () => merged(cached("ph_acid", {}).checks || [], "acid_check"),
    // /state as the server sent it, unmerged: its per-bath crate sums
    // (health), the batches it listed and every sulfur run dipped lately.
    acidState: () => cached("ph_acid", {}),

    // Consignments and their pallets (the server's, consignment.py, and this
    // phone's own unsent edits), and the packs and markets to pick from.
    consignments: () => liveMerged(cached("ph_consignments", {}).consignments || [], "consignment")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    pallets: () => liveMerged(cached("ph_consignments", {}).pallets || [], "pallet").filter((p) => !p.removed),
    packaging: () => cached("ph_packaging", []),
    markets: () => cached("ph_markets", []),
    suppliers: () => cached("ph_suppliers", []),
    // Settings -> Delivery Note: the transporters, receivers and cooled-to a new note starts with.
    noteOptions: () => cached("ph_note_options", {}),
    // Delivery notes, edited like pallets, newest first.
    notes: () => liveMerged(cached("ph_notes", {}).notes || [], "delivery_note").filter((n) => !n.removed)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),

    // Make or update a record: into the outbox first, then try to send it.
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
