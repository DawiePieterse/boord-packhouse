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
    # The suggested time and what went into it (frontend/suggest.js), kept
    # beside the minutes actually chosen so a season of runs can be used to
    # tune SulfurSettings - or replace it with a fitted model.
    suggested_minutes: Optional[int] = None
    fruit_kg: Optional[float] = None
    suggestion_temp: Optional[float] = None
    suggestion_humidity: Optional[float] = None
    # The aril SO2 estimate shown when the run started (frontend/suggest.js),
    # for comparing with lab results later. An estimate, never a measurement.
    estimated_ppm: Optional[float] = None
    # Traceability. batch_no is made on the tablet when the run starts
    # (batchNo in frontend/suggest.js): tent, farm-local date and time, the
    # fruit's blocks and two characters of the uuid. size is copied from
    # Settings -> Sulfur's list, so it still reads right after a size is removed.
    # block_id / supplier_id above are the first source; any more (a load of
    # two blocks) are a JSON list of {block_id, block_name, variety,
    # supplier_id, supplier_name} in more_sources.
    batch_no: str = ""
    size: str = ""
    more_sources: str = ""


class SulfurSettings(SQLModel, table=True):
    """Settings -> Sulfur: the numbers behind the suggested time. One row.

    There is no published formula for litchi sulfur time, so this is a
    transparent starting rule the farm tunes, not a calculation from first
    principles. A tent's default minutes is its time at these reference
    conditions; frontend/suggest.js scales it by:
      - fruit per gram of sulfur, against ref_crates x ref_crate_kg per ref_grams
        (more SO2 per kg of fruit -> shorter);
      - weather: temp_pct_per_deg % shorter per degree above ref_temp, and
        humidity_pct_per_pct % longer per % humidity above ref_humidity
        (hot and dry raises residue);
      - the variety's factor (McLean's Red takes up more than Mauritius);
    then rounds to round_to and keeps it within min/max_minutes. Zero
    percentages and factors of 1.0 make the suggestion the plain tent default.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    ref_grams: float = 425.0
    ref_crates: int = 24
    ref_crate_kg: float = 20.0  # the farm: "crates are about 20kg"
    ref_temp: float = 25.0
    ref_humidity: float = 60.0
    temp_pct_per_deg: float = 2.0
    humidity_pct_per_pct: float = 0.5
    min_minutes: int = 30
    max_minutes: int = 120
    round_to: int = 5
    variety_factors: str = '{"Mauritius": 1.0, "McLean\'s Red": 0.9}'  # JSON: variety -> factor
    # Aril SO2 against the EU limit. No published model predicts it, so the
    # estimate is anchored to one residue at the reference conditions and
    # scaled by chosen / suggested time: the suggestion is the time that
    # keeps residue at the anchor. The anchor starts as an assumption (5 ppm,
    # the farm's choice) until a lab result replaces it - residue_calibrated
    # says which, and the screen says so too. It does not model the acid dip,
    # fruit maturity or holding overnight, which all raise residue.
    residue_ref_ppm: float = 5.0
    residue_calibrated: bool = False
    residue_limit_ppm: float = 10.0   # EU limit for SO2 in the aril
    residue_warn_ppm: float = 8.0
    sizes: str = '["L", "XL", "XXL", "Mixed"]'  # JSON list: the fruit sizes the operator picks from


class Bath(SQLModel, table=True):
    """An acid bath, set up in Settings -> Acid. Retired, never deleted, so
    past batches keep resolving to it. change_days and change_crates are
    when the screen says the chemicals are due (the SOP: at least two
    changes a week)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    default_dip_minutes: int = 5
    default_dry_minutes: int = 30
    default_crates: int = 24
    change_days: float = 3.5
    change_crates: int = 500
    sort: int = 0
    active: bool = True


class AcidBatch(SQLModel, table=True):
    """Crates through an acid bath: dipped, then dried, then done.

    Made on the tablet like a SulfurRun, with the same idempotent sync:
    dip_ended_at and ended_at are each set once and never undone. Export
    fruit comes from a sulfur run (sulfur_run_uuid, its block or supplier
    copied in); local fruit comes straight from grading and has none. Not a
    foreign key: the sulfur run may still be on another tablet's outbox.
    """
    uuid: str = Field(primary_key=True)
    bath_id: int = Field(foreign_key="bath.id")
    bath_name: str = ""
    route: str = "export"           # export | local
    sulfur_run_uuid: Optional[str] = None
    crates: int
    dip_minutes: int
    dry_minutes: int
    block_id: Optional[str] = None
    block_name: str = ""
    variety: str = ""
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    started_at: datetime
    started_by: str = ""
    started_by_name: str = ""
    dip_ended_at: Optional[datetime] = None
    dip_ended_by: str = ""
    dip_ended_by_name: str = ""
    ended_at: Optional[datetime] = None
    ended_by: str = ""
    ended_by_name: str = ""
    device: str = ""
    synced_at: Optional[datetime] = None


class ChemicalChange(SQLModel, table=True):
    """The chemicals in a bath were changed. Bath health counts days and
    crates from the latest one."""
    uuid: str = Field(primary_key=True)
    bath_id: int = Field(foreign_key="bath.id")
    bath_name: str = ""
    changed_at: datetime
    crates_since: int = 0           # crates through the bath since the change before
    by: str = ""
    by_name: str = ""
    device: str = ""
    synced_at: Optional[datetime] = None


class BathCheck(SQLModel, table=True):
    """A concentration reading taken at a bath."""
    uuid: str = Field(primary_key=True)
    bath_id: int = Field(foreign_key="bath.id")
    bath_name: str = ""
    checked_at: datetime
    value: float
    note: str = ""
    by: str = ""
    by_name: str = ""
    device: str = ""
    synced_at: Optional[datetime] = None


class Packaging(SQLModel, table=True):
    """A pack the consignment screen offers, set up in Settings -> Consignment:
    "Pre-pac" at 0.48 kg, "1kg XXL" at 1.1 kg. carton_kg is the real weight of
    a full carton, so cartons x carton_kg is the kg on the pallet. Retired,
    never deleted: a pallet's lines copy the name and weight anyway."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    carton_kg: float
    sort: int = 0
    active: bool = True


class Market(SQLModel, table=True):
    """Where a consignment is going (USA Sea Freight, Local...), set up in
    Settings -> Consignment. Retired, never deleted."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    sort: int = 0
    active: bool = True


class Consignment(SQLModel, table=True):
    """The paper consignment sheet: a market and its pallets. Made on a phone
    with its own uuid and sent by POST /api/consignment/sync, like a sulfur
    run. There is no consignment number yet; the date it was made stands in."""
    uuid: str = Field(primary_key=True)
    market_id: int = Field(foreign_key="market.id")
    market_name: str = ""
    supplier_id: Optional[int] = None   # Boord's supplier, name copied like a sulfur run's
    supplier_name: str = ""
    created_at: datetime
    device: str = ""
    synced_at: Optional[datetime] = None


class Pallet(SQLModel, table=True):
    """One pallet on a consignment, identified by the code scanned off its
    label (barcode). pallet_year / pallet_no is the farm's own simple number
    (0001 each year), given by the server the first time the pallet arrives
    and never changed. lines is a JSON list of {packaging_id, packaging_name,
    carton_kg, cartons}: what is on it. removed pallets stay (their number was
    given) but free their barcode."""
    uuid: str = Field(primary_key=True)
    consignment_uuid: str = Field(foreign_key="consignment.uuid")
    barcode: str
    scanned_at: datetime
    lines: str = "[]"
    pallet_ref: str = ""        # the 3-digit pallet number written on the sheet, unique within its consignment
    removed: bool = False
    pallet_year: Optional[int] = None
    pallet_no: Optional[int] = None
    device: str = ""
    synced_at: Optional[datetime] = None
