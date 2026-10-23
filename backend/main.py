"""The Boord Packhouse service: everything that happens to fruit after Boord
Receiving checks a load in, up to the truck.

One `uvicorn main:app` process beside Boord on the farm server. The
installer binds the port to 127.0.0.1, so only the tailnet that
`tailscale serve` publishes it to can reach it at all. On top of that,
Settings needs the 4-digit PIN (admin_auth.require_admin), because every
floor tablet is on the tailnet too. Every settings endpoint must depend on
require_admin.
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import config
from backup import start_backup_scheduler
from db import init_packhouse_db
from routers import admin, backups, version, weather

app = FastAPI(title="Boord Packhouse")

for module in (admin, backups, version, weather):
    app.include_router(module.router)


@app.on_event("startup")
def on_startup():
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


# Catch-all, must be last.
app.mount("/", NoCacheStaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
