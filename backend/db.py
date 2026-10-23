"""Database access: data/packhouse.db, read-write. This process is its only
writer.
"""
from sqlmodel import Session, SQLModel, create_engine

import config

packhouse_engine = create_engine(
    f"sqlite:///{config.PACKHOUSE_DB_PATH}",
    connect_args={"check_same_thread": False},
)


def get_packhouse_session():
    with Session(packhouse_engine) as session:
        yield session


# Empty for now; each module adds its tables here.
_PACKHOUSE_TABLES: list = []


def init_packhouse_db() -> None:
    """Called at startup and by update_packhouse_server.bat."""
    # ponytail: create-only. The plan wants Alembic from day one; add it with
    # the first table (copy Boord's backend/alembic setup) so there is never
    # an unmigrated packhouse.db on the farm.
    SQLModel.metadata.create_all(packhouse_engine, tables=_PACKHOUSE_TABLES)
