"""Paths and environment for the Boord Packhouse service.

This app runs beside Boord on the farm server as its own process, the same
way Boord Labour and Boord Owner do. It owns one database (data/packhouse.db)
and will read Boord's database (data/boord.db) read-only for lots, blocks,
suppliers and workers. Every path can be overridden by an environment
variable so the Windows installer can point the service at wherever Boord
actually lives.
"""
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(_HERE, ".."))

DATA_DIR = os.environ.get("PACKHOUSE_DATA_DIR", os.path.join(REPO_ROOT, "data"))
os.makedirs(DATA_DIR, exist_ok=True)

PACKHOUSE_DB_PATH = os.environ.get("PACKHOUSE_DB_PATH", os.path.join(DATA_DIR, "packhouse.db"))

# Boord's live SQLite file. The default assumes Boord is checked out beside
# this repo (../Boord); on the farm server the installer sets BOORD_DB_PATH
# to the real absolute path (e.g. C:\Boord\data\boord.db).
# ponytail: nothing reads it yet. The first module that needs lots or workers
# adds the read-only boord_engine and the schema check - copy both from
# ../Boord-labour/backend/db.py and main.py.
BOORD_DB_PATH = os.path.abspath(os.environ.get(
    "BOORD_DB_PATH", os.path.join(REPO_ROOT, "..", "Boord", "data", "boord.db")))

# Clear of Boord 8000, Owner 8010, Notes 8020, Kudde 8030, Labour 8040,
# Monitor 8050.
#
# The installer binds this to 127.0.0.1 only, and `tailscale serve` is what
# publishes it to the tailnet. That binding decides who can reach the app.
PACKHOUSE_PORT = int(os.environ.get("PACKHOUSE_PORT", "8060"))

FRONTEND_DIR = os.path.join(REPO_ROOT, "frontend")
