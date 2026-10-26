"""The Boord Packhouse service: everything that happens to fruit after Boord
Receiving checks a load in, up to the truck.

One `uvicorn main:app` process beside Boord on the farm server. The
installer binds the port to 127.0.0.1, so only the tailnet that
`tailscale serve` publishes it to can reach it at all. On top of that,
Settings needs the 4-digit PIN (admin_auth.require_admin), because every
floor tablet is on the tailnet too. Every settings endpoint must depend on
require_admin.
"""
import os
import time

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import config
from backup import start_backup_scheduler
from boord import BOORD_SCHEMA_CHECK
from db import boord_engine, init_packhouse_db
from routers import acid, admin, backups, baths, floor, sulfur, sulfur_report, tents, version, weather

app = FastAPI(title="Boord Packhouse")

for module in (acid, admin, backups, baths, floor, sulfur, sulfur_report, tents, version, weather):
    app.include_router(module.router)


def _assert_boord_schema(conn) -> None:
    """Refuse to boot, with a clear message, rather than 500 on the floor if
    Boord renamed or dropped a column this app reads (boord.py)."""
    for table, columns in BOORD_SCHEMA_CHECK.items():
        try:
            conn.execute(text(f"SELECT {columns} FROM {table} LIMIT 1"))
        except Exception as e:  # noqa: BLE001 - re-raised with context
            raise RuntimeError(
                f"Boord's database at {config.BOORD_DB_PATH} is missing something this "
                f"app reads from `{table}` ({columns}). Boord may have migrated its "
                f"schema past what this Packhouse release supports. Underlying error: {e}"
            ) from e


# Copied from Boord Labour's main.py, which learned it the hard way: at boot
# every app starts at once and Boord migrates boord.db while it starts - the
# file is write-locked, and a batch migration briefly has no table at all.
# Waiting this long rides that out; kept well under the watchdog's 60 second
# "did it come back?" allowance, and the launcher restarts the process if it
# does give up.
BOORD_WAIT_S = 30.0
BOORD_RETRY_S = 2.0


def _wait_for_boord() -> None:
    deadline = time.monotonic() + BOORD_WAIT_S
    while True:
        try:
            if not os.path.exists(config.BOORD_DB_PATH):
                raise RuntimeError(
                    f"BOORD_DB_PATH not found: {config.BOORD_DB_PATH}\n"
                    f"Install Boord first, or set BOORD_DB_PATH to its data/boord.db.")
            with boord_engine.connect() as conn:
                _assert_boord_schema(conn)
            return
        except Exception as e:  # noqa: BLE001 - re-raised once the wait is over
            if time.monotonic() >= deadline:
                raise
            print(f"Waiting for Boord's database ({e}); retrying in {BOORD_RETRY_S:g}s.", flush=True)
            time.sleep(BOORD_RETRY_S)


@app.on_event("startup")
def on_startup():
    _wait_for_boord()
    init_packhouse_db()
    start_backup_scheduler()


class NoCacheStaticFiles(StaticFiles):
    """Tablets keep the app open for days, so force revalidation - a browser
    must not keep serving JS from before the last deploy. Copied from
    Boord's main.py."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Boord's photo folder, read-only. Mounted only if it is there: a farm that
# never took photos should get a missing face, not a server that won't boot.
if os.path.isdir(config.BOORD_PHOTOS_DIR):
    app.mount("/photos", StaticFiles(directory=config.BOORD_PHOTOS_DIR), name="photos")

# Catch-all, must be last.
app.mount("/", NoCacheStaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
