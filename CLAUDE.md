# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Boord Packhouse covers everything that happens to fruit after Boord Receiving checks a load in, up to the moment a pallet or juice bin leaves on a truck. `Boord_Packhouse_App_Plan.md` is the plan: the fruit's routes, the roles, the data model and the build stages. It follows the **Boord Labour** pattern (`../Boord-labour`):

- its own uvicorn process on port **8060**, bound to 127.0.0.1 and published only via `tailscale serve --https=8060`;
- its own SQLite `data/packhouse.db`;
- Boord's `boord.db` opened **read-only** (not wired yet: the first module that needs lots or workers adds it, copying Labour's `boord_engine` and `_BOORD_SCHEMA_CHECK`).

Access has two layers:
- **Tailscale** gets you to the app at all. It binds 127.0.0.1; never bind 0.0.0.0.
- **The 4-digit settings PIN** separates Settings (and later corrections and overrides) from the floor screens, which have no login; who did what will be a Boord badge scan.
  - **Every settings endpoint must depend on `admin_auth.require_admin`**, which checks the `packhouse_admin` cookie. The floor endpoints (`/api/version`, `/api/weather/current`) stay open.
  - The PIN is exactly 4 digits, pbkdf2-hashed in `data/admin_pin.txt`, and set only from the server console (`backend/set_pin.py`, also run by `install.ps1`), never via the web. Five wrong tries lock it for 5 minutes.
  - Unlike Labour's admin phone, the tablets are shared: the cookie is a session cookie, and `app.js` signs out when Settings is left, after 5 idle minutes, and on every page load.
  - In tests, use the `admin_client` fixture for settings endpoints. The TestClient runs on https because the cookie is Secure.

## The Boord suite

This app is one of seven that run together on the farm PC (`bekfontein-server`), each its own repo, process, port and database. They are reached only over Tailscale, and each binds `127.0.0.1` and is published with `tailscale serve`. The same section is in every app's `CLAUDE.md`. When a fact here changes, change it in all seven.

| App | Repo (`DawiePieterse/…`) | What it does | Port | Tailnet address | Mac folder | Farm PC folder |
|---|---|---|---|---|---|---|
| Boord | `Boord` | Harvest capture and picker pay per kg: field tablets, pack-house receiving, admin office. The hub. | 8000 | `https://bekfontein-server.taile32cb0.ts.net/` | `~/Documents/Projects/Boord` | `C:\Boord` |
| Boord Owner | `boordowner` | The owner's view: season vs history, weather, risk, crop estimate, optional AI. | 8010 | `https://bekfontein-server.taile32cb0.ts.net:8443/` | `~/Documents/Projects/BoordOwner` | `C:\BoordOwner` |
| Boord Notes | `boord-notes` | Private farm notebook for Andre and his son, offline-first, optional AI. | 8020 | `https://bekfontein-server.taile32cb0.ts.net:9443/` | `~/Documents/Projects/BoordNotes` | `C:\bekfontein-farm-notebook` |
| Kudde | `Kudde` | Cattle records: animals and their events. | 8030 | `https://bekfontein-server.taile32cb0.ts.net:8030/` | `~/Documents/Projects/Kudde` | `C:\Kudde` |
| Boord Labour | `Boord-labour` | Packhouse time clock: badge scans at the door, hourly pay with overtime. | 8040 | `https://bekfontein-server.taile32cb0.ts.net:8040/` | `~/Documents/Projects/Boord-labour` | `C:\Boord-labour` |
| Boord Monitor | `Boord-monitor` | Watches the PC and the other five apps; Web Push alerts and a Restart button. | 8050 | `https://bekfontein-server.taile32cb0.ts.net:8050/` | `~/Documents/Projects/Boord-monitor` | `C:\boord-monitor` |
| **Boord Packhouse** (this app) | `boord-packhouse` | After receiving to the truck: sulfur, acid, lines, pre-pack, cold store and PPECB, dispatch. | 8060 | `https://bekfontein-server.taile32cb0.ts.net:8060/` | `~/Documents/Projects/Boord-packhouse` | `C:\Boord-packhouse` |

**How they depend on each other:**
- **Boord is the hub.** Its `data/boord.db` is opened read-only by Owner (harvest, lots, blocks, suppliers), Labour (the worker register, and Boord's `data/photos` for faces), Monitor (tablet station, last sync and outbox) and, once its modules land, Packhouse (received lots, blocks, suppliers, workers).
  - Boord is that database's only writer and migrates it at startup.
  - Owner and Labour refuse to boot if a column they read disappears. A Boord migration that drops or renames a column needs those apps updated in step.
- **Labour's badges are Boord's.** The badge QR holds exactly `worker.id` (`Boord/frontend/admin/print-badge.html`), and Labour vendors Boord's `frontend/shared/`.
- **Owner asks Notes.** The "Ask the farm notes" bridge calls Notes' `/api/ai/ask` at `OWNER_NOTES_URL` (`http://127.0.0.1:8020`) and can share Notes' `data/anthropic_key.txt`.
- **Boord keeps the others running.** Boord's `watchdog.ps1` (restarts an app that stops answering) and `heartbeat.ps1` cover the first six. **Packhouse is not in them yet**, nor in Monitor's `backend/apps.py`, nor in the other six repos' copies of this table.
  - Their app table (name, port, task, health path) must match Monitor's `backend/apps.py` and the port table above. Change them together.
  - Monitor reads Boord's `data/watchdog.log`, and its Restart button runs Boord's `watchdog.ps1 -Restart "<Name>"`.
- **Monitor watches everything.** It shows each app's up/down state and `/api/version`, Tailscale and the PC, and pushes an alert after three failed checks in a row.
  - Every app's `/api/version` keeps the same field names (`tag`, `state`, `frontend_version`), because Monitor and the heartbeat read them all.
  - An off-site copy of the monitor on the owner's Mac alerts when the whole farm PC is unreachable.
- **Kudde and Notes stand alone.** No other app reads their data. They are only watched and restarted.

**What they share by convention, not code:**
- One release key: fingerprint `67C64CFDD584DD140E58AF6E329C9B9DD0562A9D` in each app's `data\release_key.fpr`.
- Releases are signed tags, made from an up-to-date `main` on the Mac and installed by each app's updater on the farm PC.
- `stop_server.ps1` stops each server, never a bare `schtasks /end`. Boord Labour's copy is the reference; this repo carries an adapted copy.
- Each installer adds a Git `safe.directory` exception so SYSTEM's Git can read the repo folder.
- Python 3.9-compatible code, plain JS with no CDNs (the phones are tailnet-only), and `VERSION` plus the service-worker `CACHE` bumped with every frontend change.
- Fixes to the copied deployment files (`install.ps1`, the updaters, `stop_server.ps1`, `release.sh`) flow between the repos.

## Commands

```bash
cd backend
/usr/bin/python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # Python 3.9: the farm's minimum
.venv/bin/python -m pytest                       # all tests
.venv/bin/python run_preview.py                  # dev server, http://localhost:8060/
scripts/release.sh v0.1    # signed release tag (VERSION in frontend/shared/api.js must match)
```

Keep code Python 3.9-compatible: no `X | None`, no `match`.

## Architecture

- **Home screen** (`frontend/index.html`, `app.js`): a grid of big icons, one per role (`MODULES` in app.js). A role opens full screen at `#<id>`. The bottom menu has Home and Settings (behind the PIN keypad). Once the PIN is in, Settings swaps in its own bottom menu: Home (which signs Settings out) and one button per page in `SETTINGS_PAGES` (app.js), at `#settings/<id>`. A new settings page is an entry there plus a `<div data-settings-page="<id>">` in index.html; its `load` runs each time it opens. Every role is a placeholder until its build stage lands.
- **Header:** the weather strip comes from `GET /api/weather/current`, which passes Boord's own `/api/weather/current` through from `BOORD_URL` (default `http://127.0.0.1:8000`). Boord owns the source (iWeathar station or GPS in Boord's Settings) and its cache; an unreachable Boord is `{}`, never an error. The sync pill uses Field's colours; today it only probes `/api/version`, and gains the outbox count when the first module queues records.
- **Backups** (`backend/backup.py`, Boord's backup.py trimmed by way of Labour's): at 02:00 every night, when `packhouse.db` changed since the last archive (hash of a SQLite-API snapshot), it writes `data/backups/packhouse_backup_*.zip` and keeps the newest 14. Settings has Backup Now (always writes one), the list and Download, all behind `require_admin`. Off-site copies go to the folder in **Boord's** `data/backup_copy_to.txt`. The pruner only matches `packhouse_backup_*.zip`, so the updater's `packhouse-before-*.db` copies are never touched.
- **Schema:** `db.init_packhouse_db()` creates `_PACKHOUSE_TABLES` and runs at startup and in the updater. It is empty today. Add Alembic (copy Boord's setup) with the first table, as the plan asks.
- **Frontend:** a single vanilla-JS PWA, no build step. `frontend/shared/` (api.js, sw-core.js, styles.css, tailwind.js, vendor/) is vendored from Boord via Labour. Only `VERSION` in api.js is ours. Bump `CACHE` in `service-worker.js` when shell files change.
- **Icon:** Boord's crate with an orange leaf (`#fb923c`), rendered with `../Boord/scripts/render_icons.py`'s `render()`.
- **Deployment files** (`install.ps1`, `install.bat`, `update_packhouse_server.bat`, `stop_server.ps1`, `scripts/release.sh`) are adapted from Boord Labour's. Keep fixes flowing between the sibling repos. `tests/test_updater.py` keeps the updater's import check equal to `requirements.txt`.

## Installing and deploying

### Where it lives

| | |
|---|---|
| Your Mac (the only clone to release from) | `~/Documents/Projects/Boord-packhouse` |
| Farm PC folder | `C:\Boord-packhouse` |
| Farm PC scheduled task | "Boord Packhouse Server", runs as SYSTEM at boot |
| Port on the farm PC | `127.0.0.1:8060` |
| Address on the tailnet | `https://bekfontein-server.taile32cb0.ts.net:8060/` |

### First install on the farm PC (once)

Only for a new PC or a reinstall. An app that is already running is updated, not reinstalled.

1. Open a Command Prompt and clone the repo into the folder above:
   ```bat
   git clone https://github.com/DawiePieterse/boord-packhouse.git C:\Boord-packhouse
   ```
2. In `C:\Boord-packhouse`, double-click **`install.bat`** and accept the administrator prompt. It asks for the full path to Boord's `data\boord.db`.
   It installs Python if needed, builds the app's environment, writes the launcher, registers the scheduled task, reserves the port so Windows can't hand it to Hyper-V, WSL or Docker at boot, and starts the server. Re-running it is safe and keeps the data.
3. Tell the updater which release key to trust. In the same folder, type it exactly like this, with the redirect first:
   ```bat
   >data\release_key.fpr echo 67C64CFDD584DD140E58AF6E329C9B9DD0562A9D
   ```
4. Publish it on the tailnet, in a Command Prompt opened as administrator:
   ```bat
   tailscale serve --bg --https=8060 http://localhost:8060
   ```
5. If the installer did not already add it, let SYSTEM's Git read the folder, as administrator (forward slashes):
   ```bat
   git config --system --add safe.directory C:/Boord-packhouse
   ```
6. Check it from your Mac: `curl -s https://bekfontein-server.taile32cb0.ts.net:8060/api/version` should show the release tag.

### Deploying a change (every release)

Merging to `main` changes nothing on the farm. A release is a signed tag, and the farm PC installs it when its updater runs.

1. **Merge the PR on GitHub.** A frontend change must already bump `VERSION` in `frontend/shared/api.js` and the service worker's `CACHE`.
2. **On your Mac, bring the clone up to date.** This step is what stops a tag landing on an old commit:
   ```sh
   cd ~/Documents/Projects/Boord-packhouse && git checkout main && git pull --ff-only origin main
   git log -1 --format='%h %s'                  # the merge you expect
   grep -m1 'VERSION:' frontend/shared/api.js   # the version you are releasing
   ```
3. **Sign and push the tag** (`vX.Y` must equal `VERSION`):
   ```sh
   scripts/release.sh vX.Y && git push origin vX.Y
   ```
   Never move or reuse a released tag. Fix a wrong one with the next version.
4. **On the farm PC**, in `C:\Boord-packhouse`, double-click **`update_packhouse_server.bat`**. It verifies the signature, stops the server with `stop_server.ps1`, installs dependencies, copies and migrates the database, and starts it again. If it stops with an error, nothing has changed. Read the message; never check the tag out by hand.
5. **If the release changed `install.ps1`** (its notes say "run install.bat once more"), double-click `install.bat` as well. The updater does not rewrite the launcher or the task.
6. **Check from your Mac:** `curl -s https://bekfontein-server.taile32cb0.ts.net:8060/api/version` should show `"tag":"vX.Y","state":"release"`.
7. **Close and reopen the app on each tablet so they load the new version.**
