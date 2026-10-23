# Boord Packhouse — App Plan

Oct 22, 2026 · @Dawie P

## Summary

Boord Packhouse is a new sibling app in the Boord suite. It covers everything that happens to fruit after Boord Receiving checks a load in, up to the moment a pallet or juice bin leaves on a truck.

- **One PWA, one home screen of big icons:** Sulfur tent, Acid bath, Pre-pack, Lines, Cold store & PPECB, Dispatch. Any tablet can open any role; the role decides what the backend does with each tap. A screen for every process where paper is currently used.
- **The process follows the Pack House SOP and the Process Comparison table**, not the old Laughing Waters app. Each lot is split into five routes (USA, EU, Local, Juice, Pre-pack), and the route decides which steps are required.
- **It installs on the farm server like Boord Labour:** its own port, its own database, and Boord's database opened read-only for lots, blocks, suppliers and workers.
- **Who did what is captured with a badge scan, not a login.** It reuses the Boord worker badge QR that Boord Labour already scans at the door.

## Where it sits in the Boord suite

Boord Packhouse copies the pattern of Boord Labour and Boord Owner: a separate uvicorn process, its own SQLite file, and Boord's `boord.db` opened read-only (`PRAGMA query_only=ON`). Boord stays the only writer of its own database.

|  | Boord Packhouse |
| --- | --- |
| Process | FastAPI + SQLModel, Python 3.9-compatible |
| Port | **8060** on 127.0.0.1, published with `tailscale serve --https=8060` (next free slot after Monitor's 8050) |
| Own database | `data/packhouse.db`, with Alembic migrations from day one (as Boord now has) |
| Reads from Boord | received lots, receiving records, suppliers (PUC, GGN), blocks, workers + photos, pack house name and PHC |
| Frontend | one vanilla-JS PWA, no build step; `frontend/shared/` vendored from Boord |
| Read by | Boord Owner (later), which opens `packhouse.db` read-only for the dashboard |

**The hand-off from Boord is the received lot.** Packhouse lists every lot whose Boord status is `received`. From then on it keeps its own state per lot (crates still to route, still in sulfur, packed and so on). It never writes `processing_complete` back into Boord.

A schema check like `_BOORD_SCHEMA_CHECK` refuses to boot if Boord drops a column Packhouse reads, the same guard Labour and Owner use.

## The fruit's routes

Every received lot is split into one or more of five routes, and the route decides which steps the app requires before the fruit can be dispatched. This follows the Process Comparison table and the Pack House SOP (v1.0, July 2026).

**Step order (revised October 2026):** intake and initial classification (in Boord Receiving), then grading and sizing on one of the two lines. At the grading and sizing table, pre-pack fruit goes to the pre-pack table and juice fruit into bins; neither gets any chemical treatment. Export fruit goes to the sulfur tent by the pallet (about 24 crates), then through an acid bath to bring back the red colour. Local fruit goes straight from grading to the acid bath. Then packing, cold store and PPECB for export, and dispatch.

**This swaps sulfur and acid from SOP v1.0**, following current industry practice: the acid dip comes after sulfur to restore colour. The old app also had sulfur before the acid bath, but put both before grading.

| Step | USA export | EU export | Local | Juice | Pre-pack (local) |
| --- | --- | --- | --- | --- | --- |
| Block recorded | Required | Required | Basic | Basic | Basic |
| Sulfur tent (425 g) | Required | Required | Mostly no | No | No |
| Acid bath | Required | Required | Yes | No | No |
| Packed into | Export cartons (select size) | Export cartons (select size) | Local cartons (select size) | Bins | Punnets (select size) , then cartons (number of punnets and total kg) |
| Barcodes | Full + block | Full + block | Basic, farm details | Bin ID only | Punnet + carton |
| Cold store | Until PPECB | Until PPECB | Little or none | Bins wait for truck | Little or none |
| PPECB inspection | Mandatory | Required | No | No | No |
| Truck to | Sea: Joburg, then Cape Town harbour. Air: OR Tambo | Sea: Joburg, then Cape Town harbour. Air: OR Tambo | Local markets / Joburg | Juice buyer | Local markets / Joburg |

**Pre-pack is for the local market only.** It is a premium packing format (punnets in cartons) for local buyers. It gets no acid bath and no sulfur, and never goes to PPECB or export.

**The app checks the route rules, it doesn't hard-block them.** If a USA carton has no sulfur run behind it, the screen warns and the dispatch screen won't release that pallet.

The settings let the office change these rules (for example the 425 g dose), because other farms and crops will differ.

## Roles: the big icons

The home screen is a grid of large icons, sized for wet hands and gloves. Each one shows a live badge: crates waiting, a timer running, or an alarm. Tapping an icon opens that role full screen, and a large Home button always goes back.

### Sulfur tent

- **Load a run:** by pallet, about 24 crates each. Count/confirm the crates, set the dose (default 425 g, set in settings) and the target duration (automatically calculated?), then press Start. Temperature and humidity are pre-filled from on farm weather station, because the SOP adjusts duration by conditions and requires them on the record.
- A large countdown with an overrun alarm. Several tents run side by side, tent 1, tent 2, etc. (set in settings)
- Captures: run ID, tent ID, number of crates, dose in grams, start and end time, duration, temperature and humidity, operator.

### Acid bath

- One panel per bath (two at Laughing Waters, one per line). **Built (v0.14).** Export batches are picked from finished sulfur runs; local batches straight from grading.
- **A batch** is crates going through: start, dip timer, drying timer, done.
- Bath health: days and crates since the last chemical change. It warns when a bath hasn't been changed in 3 to 4 days (the SOP requires at least two changes a week) or when it passes 500 crates; both limits are settings. A Concentration check button logs each reading. A **Chemicals changed** button resets it and logs who changed it and when.
- Captures: batch ID, bath ID, number of crates, times, operator, chemical changes, concentration checks.

### Lines (grading and packing)

- One screen per physical line, chosen when the role opens.
- **Grading splits fruit into routes:** the operator records grade, size category and crates or kg going to USA, EU, Local, Juice and Pre-pack (SOP 5.2). Juice goes straight to bins and pre-pack to the pre-pack table; export fruit goes to the sulfur tent, and local fruit straight to the acid bath.
- **Packing:** cartons are counted onto a pallet by size and variety, not barcoded one by one. This matches the packhouse's current paper pallet sheets. The block is filled in from the day's intake when only one block came in; otherwise the packer chooses it from that day's blocks. The block is required on USA and EU pallets.
- **Palletising (replaces the paper USA and Pallets sheets):** a pallet gets the next pallet number, its route and agent, block and date code. It then gets one or more lines of size (XXL, XL, L or mix) × variety (ELD Early Delight, TMR Third Month Red) × carton count. The variety comes from the block in Boord, so it fills itself in when only one variety was received that day. Scan the pre-printed SSCC sticker (`(00) 0 6009900 …`) onto export pallets. Record the TempTale logger number where one is packed. The screen shows the running total against a full pallet (192 cartons for USA, 480 for local, set in settings).
- **Juice bins:** a weighed bin with no cartons. Its bin ID is its only label.
- Read-only strip at the top: this line's acid bath status, and fruit back from the acid bath ready to pack.

### Pre-pack

- Takes the premium fruit (XL, Double XL) that grading routed to pre-pack, straight from the grading and sizing table with no acid or sulfur.
- Records punnets by size (set in settings and select, 180 to 500 g), packs punnets into cartons (settings, number of punnets per carton based on punnet size), and builds them onto a pre-pack pallet (count cartons).
- Captures: punnet count and weight, carton barcodes, operator.

### Cold store & PPECB

- **Pallets in and out** by scanning the pallet ticket: which room and when. Temperature logs per room are required for export fruit (SOP section 6).
- **PPECB inspection** per pallet or consignment: inspector, date, Pass, Fail or Re-inspect, the reference number, and a photo of the inspection document.
- A failed pallet is flagged everywhere and can't be dispatched as export.

### Dispatch / juice bins

- **Build a load:** scan pallets and juice bins onto a truck. Export loads are sea or air freight. Captures freight mode, destination, transporter, driver, vehicle registration, waybill or dispatch note, final pallet weights, container details for sea freight, and air waybill and flight for air freight.
- **Release check:** export pallets need a sulfur run, an acid batch and a PPECB pass. If anything is missing, the screen shows what's missing and won't release the load.
- Prints or shares a load sheet (PDF or WhatsApp), the same way Boord shares payslips.

## Data model (packhouse.db)

**Traceability is by day and block, not by crate.** Once Boord Receiving checks fruit in, it is mixed on the sorting tables, so the per-crate block is lost. The packhouse works from **the day's intake**: the lots received that day and the blocks they came from.

- **One block received:** every carton, punnet and bin packed that day is assumed to be from that block, and the app fills it in.
- **Several blocks received:** the packer chooses the block when packing, from a short list of the blocks received that day (override should be possible). It's required for USA and EU cartons and optional for local.

A carton barcode therefore traces to its packing day and chosen block, then to the Boord lots of that block received that day, and from there to the supplier, PUC and pickers. Every step is still its own table, so the step order can change without redesigning anything.

| Table | Holds | Points at |
| --- | --- | --- |
| `LotState` | The day's intake: which received lots and blocks are in today's pool, crates still to grade | Boord `lot.id` |
| `SulfurRun` | tent, dose g, target and actual minutes, start, end, temperature, humidity, operator | the crate pallets loaded, via `SulfurRunPallet` (pallet, crates), each tracing back to its grading split |
| `AcidBatch` | bath, crates, dip and dry times, operator | the sulfur runs (export) or grading splits (local) it took in |
| `ChemicalChange` | bath, time, who, crate count at the change; plus BathCheck rows for concentration readings | bath |
| `GradingSplit` | line, grade, size category, route, crates or kg, time, operator | lot |
| `Punnet` | size g, count, weight | grading split |
| `PalletLine` | size (XXL, XL, L, mix), variety (ELD, TMR), carton count, packed at, operator | pallet; the grading split or punnets it came from |
| `Pallet` | pallet number, SSCC (export), route, agent, block, date code, TempTale number, carton total, gross kg, status | pallet lines, or one juice bin |
| `ColdStoreMove` | pallet, room, in or out, time, temperature | pallet |
| `PpecbInspection` | inspector, result, reference, photo, time | pallets |
| `Load` | freight mode (sea or air), truck, transporter, driver, registration, waybill, container or air waybill and flight, destination, dispatched at | pallets |
| `Station`, `Agent` | tents, baths and lines on this site; market agents and exporters (Seasons Farm Fresh, TORO, Dapper and so on) |  |
| `PackSetting` | sulfur dose, chemical-change threshold, route rules |  |

**The pallet is the unit that gets a barcode.** Export pallets carry a GS1 SSCC from the pre-printed sticker rolls, and the app scans it rather than printing its own. Local and pre-pack pallets are known by their pallet number. Juice bins get a `J-` number. Cartons are counted, not individually labelled.

All writes from tablets carry a client UUID and are idempotent, as Boord Labour's scans already are.

## Who did it: operator without a login

Any tablet can open any role, so the app needs some other way to know who is working. **When a role opens, the operator scans their Boord badge** (or taps their name and photo from a short list), and that name is stamped on every record until they press Home or the tablet sits idle for a set time.

- The badge QR already holds the Boord `worker.id`, and Boord Labour scans the same badge at the door, so nothing new needs printing.
- Office-only actions sit behind a PIN, using the same `require_admin` pattern as Labour: editing a record after the fact, overriding a release check, and changing settings. Every correction needs a reason and leaves an audit row.
- Floor screens never need a password, which keeps the big-icon promise.

## Offline, install and updates

**Offline:** packhouse tablets queue their work the way Field does, not the way Receiving does. Each record goes into an IndexedDB outbox and is synced by UUID. Timers run on the tablet from a stored start time, so a dropped connection never stops a sulfur countdown. A tablet reports its unsent outbox to Boord Monitor, the same way Field does.

**Install:** `install.ps1` / `install.bat` are adapted from Boord Labour's. They create the venv, set the admin PIN from the server console, register auto-start, and run `tailscale serve --https=8060`. The server binds 127.0.0.1 only.

**Updates:** signed release tags checked against `release-key.asc`, with `update_packhouse_server.bat`, the same as the sibling apps. `VERSION` in `api.js` must match the tag.

**Printing:** carton, pallet and bin labels need a label printer reachable from the server or tablets. Which printer to use is an open question below.

## Changes needed in the other Boord apps

| App | Change | Why |
| --- | --- | --- |
| Boord | Retire the pre-pack pull at receiving (`PrePackRecord`, `/api/processing/prepack`) | The PDF puts the pre-pack decision after grading, not at the gate |
| Boord | Stop using `LotStatus.processing_complete`, or leave it unused | Packhouse owns everything after receiving; Boord doesn't need to know |
| Boord | Add Packhouse 8060 to the Tailscale port table in MANUAL.md, `watchdog.ps1` and `heartbeat.ps1` | That's where the suite's app list lives |
| Boord | Root page: admin devices also offer "Packhouse" | One address to find every app |
| Boord Owner | Read `packhouse.db` read-only: packout per route, tonnes per market, PPECB pass rate | The owner's whole-season view |
| Boord Labour | Nothing required. Later, it could link worked hours to the stations people scanned into | Labour cost per station |

## Open questions

- [x] **Step order:** settled: grading, then sulfur (export only), then the acid bath (export and local).
- [ ] **Pre-pack and the acid bath:** *answered: pre-pack goes from the grading and sizing table straight to the pre-pack table, with no acid bath** **o**r s**ul**f**u**r **t**reat**m**en**t**.*
- [ ] **Pre-pack and sulfur:** answered: pre-pack is local market only, so it gets no sulfur.
- [ ] **Sulfur pallets:** are these pallets of field crates with no ID today? The app would give each one a ticket at the end of the line. These are new pallets from fruit that came from the sorting table in crates. 24 crates per pallet for the sulfur treatment.
- [ ] **Initial classification at the gate (SOP 5.1):** should Boord Receiving record a first quality class per load, or is grading on the lines enough? the lines are enough
- [ ] **Sulfur and acid order (check with Andre):** the SOP has the acid bath *before* sulfur. Industry write-ups and the old app have sulfur first, then an acid dip to bring the red colour back. An acid dip may also raise sulfur residue, which PPECB checks. Decided: sulfur first, then the acid bath, as current guidelines describe.
- [ ] **28 mm local limit:** one source gives a 30 mm minimum for export and 28 mm for local. Our plan sends anything under about 30 mm to juice. Should 28–30 mm fruit go to local instead? Either way, the size limits become settings. Set in settings
- [ ] **Air freight:** USA and EU fruit can go by air through OR Tambo as well as by sea. Does air-freight fruit still get sulfur and the acid bath, or is it treated differently? Is the sea or air decision made at grading, or only at dispatch?
- [ ] **Other growers' fruit:** when an outside supplier delivers on the same day, is their fruit run separately from the farm's own, or mixed in too? Export cartons carry the grower's PUC, so mixing growers matters more than mixing blocks. Will be kept separate.
- [ ] **Day boundary:** fruit received late in the afternoon and packed the next morning. Should the day's intake carry over until it is graded, rather than reset at midnight?
- [ ] **From Andre's pallet sheets (ask him):**
  - *Answered:* ELD and TMR are varieties, Early Delight and Third Month Red. They come from Boord's block variety field, which must be filled in for every block.
  - What does the **date code** "0505" mean, and how is it worked out?
  - Do USA and local pallets have separate number series (667… versus 323…)?
  - Is the **TempTale** logged per pallet or per container? Do EU pallets get SSCC stickers and TempTales too?
  - Which agents does the farm use: Seasons Farm Fresh for USA; TORO, Dapper, Bose T and others for local?
- [ ] **Grading unit:** crates, kg, or both? Crates
- [ ] **Counts:** how many sulfur tents and cold rooms? Is it fixed at 2 lines and 2 baths? ***CHECK***
- [ ] **Bath concentration:** what is measured (pH, % acid), and what is the acceptable range? ***CHECK***
- [ ] **Labels:** which label printer, and are cartons pre-printed with barcodes? ***CHECK***
- [ ] **PPECB:** inspected per pallet or per consignment, and what reference does the inspector give? ***CHECK***
- [ ] **Name:** Boord Packhouse, or Boord Pakhuis? Boord Pakhuis

## Build stages

Each stage ends with something usable on the floor (previously some paper output), and the release checks come last because they need every step before them.

**Code to reuse:** the old full app (*Laughing Waters Harvesting\_old*) already has working sulfur, acid, pre-pack and processing screens: countdown timers, overrun alarms, the bath crate counter, carton barcodes and pallets. Port those screens and rewire them to the SOP order instead of starting from blank. *Harvesting Lite* is Boord's August predecessor; its packhouse side is Receiving only, so there is nothing new there for this app.

1. **Skeleton:** repo, install scripts, port 8060, read-only Boord connection with schema check, home screen of six icons, badge scan, offline outbox.
2. **Sulfur tent + Acid bath:** queues, timers, alarms, chemical-change counter. These are the most self-contained screens and the quickest win.
3. **Lines:** grading split by route, cartons with barcodes, pallets, juice bins, label printing.
4. **Pre-pack:** punnets, cartons, pallets with a destination.
5. **Cold store & PPECB:** pallet moves and inspection results.
6. **Dispatch:** loads, waybills, release checks, load sheet.
7. **Trace and Boord Owner:** barcode trace-back screen, Owner dashboard figures, and retiring Boord's pre-pack pull.
