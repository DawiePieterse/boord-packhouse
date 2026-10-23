// Write-ahead log for sulfur runs and acid records, the same idea as Boord Labour's idb.js and
// Boord Field's. A run lands here first with synced = 0 - started, or ended
// on this tablet - so it is never lost to patchy Wi-Fi; sync.js sends the
// unsynced ones until the server has them.
//
// Every request settles - an IndexedDB request with no onerror would leave
// its promise pending forever and freeze whatever awaited it.
const IDB = (() => {
  const DB_NAME = "boord_packhouse_db";
  const STORE = "runs";
  // The server has a synced run; a few days here is only so this tablet's
  // own runs still show while the server can't be reached.
  const PRUNE_AFTER_DAYS = 3;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "uuid" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    put: (r) => run("readwrite", (s) => s.put(r)),
    all: () => run("readonly", (s) => s.getAll()),
    async pending() {
      return (await this.all()).filter((r) => !r.synced);
    },
    // Only rows that have not changed since they were sent: a run ended on
    // this tablet while its start was in flight must stay pending.
    async markSynced(sent, error = "") {
      const stamp = (r) => `${r.dip_ended_at || ""}|${r.ended_at || ""}`;
      const want = new Map(sent.map((r) => [r.uuid, stamp(r)]));
      const rows = (await this.all()).filter((r) => want.has(r.uuid) && want.get(r.uuid) === stamp(r));
      await run("readwrite", (s) => rows.forEach((r) => s.put({ ...r, synced: 1, error })));
    },
    async prune() {
      const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 864e5).toISOString();
      const stale = (await this.all()).filter((r) => r.synced && (r.started_at || r.changed_at || r.checked_at) < cutoff);
      await run("readwrite", (s) => stale.forEach((r) => s.delete(r.uuid)));
    },
  };
})();
