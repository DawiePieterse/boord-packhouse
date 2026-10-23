"""packhouse.db's tables. Every change here needs an Alembic migration
(migrations/versions/) - see migrate.py.

Boord's tables are NOT mirrored here: boord.py reads them with plain SQL, so
they never land on this metadata and never in a migration of ours.

Timestamps are UTC, stored naive (SQLite drops the tzinfo) - timeutil.py
bridges to farm time.
"""
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Tent(SQLModel, table=True):
    """A sulfur tent, set up in Settings -> Tents. Retired, never deleted,
    so past runs keep resolving to it."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    default_grams: float = 425.0
    default_minutes: int = 60
    default_crates: int = 24
    sort: int = 0
    active: bool = True


class SulfurRun(SQLModel, table=True):
    """One load through a sulfur tent.

    The primary key is made on the tablet, so a run started with no Wi-Fi
    can be sent again and again until it lands (POST /api/sulfur/sync is an
    idempotent upsert). Names are copied in when the run is made, so the
    record still reads right after a tent, block or worker is renamed.
    Exactly one of block_id / supplier_id is set: the farm's own block, or
    another farmer's fruit.
    """
    uuid: str = Field(primary_key=True)
    tent_id: int = Field(foreign_key="tent.id")
    tent_name: str = ""
    grams: float
    minutes: int
    crates: int
    block_id: Optional[str] = None
    block_name: str = ""
    variety: str = ""
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    started_at: datetime
    started_by: str = ""        # Boord worker.id from the badge
    started_by_name: str = ""
    ended_at: Optional[datetime] = None
    ended_by: str = ""
    ended_by_name: str = ""
    # Stamped by the server when the run arrives within a few minutes of its
    # start; a run that sat offline gets none rather than the wrong weather.
    weather_temp: Optional[float] = None
    weather_humidity: Optional[float] = None
    device: str = ""
    synced_at: Optional[datetime] = None
