"""Schema migrations for packhouse.db - Boord's migrate.py, trimmed.

Boord's also adopts databases from before it had Alembic. Packhouse had
Alembic from its first table, so there is nothing to adopt: a database is
brought to the newest revision, and that is all. (A packhouse.db from v0.1 to
v0.5 holds no tables and is simply built from the first migration.)

Run at startup (db.init_packhouse_db) and by update_packhouse_server.bat in
the foreground before the server restarts, after the updater has copied the
database to data/backups/packhouse-before-*.db.

To add a migration after changing models.py:
    cd backend && .venv/bin/python -m alembic revision --autogenerate -m "what changed"
"""
import os

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlmodel import SQLModel

import models  # noqa: F401 - registers every table on SQLModel.metadata

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _config(target_engine) -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    # Absolute: a Scheduled Task starts the server from wherever Windows picks.
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "migrations"))
    cfg.attributes["connectable"] = target_engine
    cfg.attributes["configure_logger"] = False
    return cfg


def _report_drift(target_engine) -> None:
    """Say so if models.py changed without a migration. Printed, never
    raised: a farm server has to boot."""
    with target_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), SQLModel.metadata)
    if diff:
        print("[migration] WARNING: the database does not match models.py:", flush=True)
        for entry in diff:
            print(f"[migration]   {entry}", flush=True)


def run_migrations(target_engine) -> None:
    command.upgrade(_config(target_engine), "head")
    _report_drift(target_engine)
