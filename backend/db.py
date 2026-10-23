"""Database access. Two engines, on purpose - the same split as Boord Labour:

  packhouse_engine - data/packhouse.db, READ-WRITE. This process is its only
                     writer; its schema is Alembic's (migrate.py).

  boord_engine     - Boord's data/boord.db, READ-ONLY. Boord is the sole
                     writer and migrates that file on its own startup, so
                     every read here is short-lived (NullPool). boord.py
                     holds the queries.

Read-only is enforced with `PRAGMA query_only=ON` rather than sqlite's
`?mode=ro`: a true read-only handle cannot open the -wal/-shm sidecars if
Boord ever runs in WAL mode. query_only rejects writes at the SQL layer while
letting SQLite journal normally.
"""
from sqlalchemy import event, pool
from sqlmodel import Session, create_engine

import config

packhouse_engine = create_engine(
    f"sqlite:///{config.PACKHOUSE_DB_PATH}",
    connect_args={"check_same_thread": False},
)

boord_engine = create_engine(
    f"sqlite:///{config.BOORD_DB_PATH}",
    connect_args={"check_same_thread": False},
    poolclass=pool.NullPool,  # never hold a Boord connection between requests
)


@event.listens_for(boord_engine, "connect")
def _boord_readonly(dbapi_conn, _rec):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA query_only=ON")      # reject every write at the SQL layer
    cur.execute("PRAGMA busy_timeout=3000")  # wait briefly on Boord's write lock, don't error
    cur.close()


def get_packhouse_session():
    with Session(packhouse_engine) as session:
        yield session


def init_packhouse_db() -> None:
    """Called at startup and by update_packhouse_server.bat."""
    from migrate import run_migrations  # here: migrations/env.py imports this module
    run_migrations(packhouse_engine)
