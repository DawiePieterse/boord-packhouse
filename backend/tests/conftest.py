"""Test fixtures. Environment is set BEFORE config/db/main are imported,
because they read it at import time. TZ is pinned to SAST so "today" means
the same farm day on every machine that runs this suite."""
import os
import sqlite3
import tempfile
import time
from datetime import datetime, timedelta, timezone

_TMP = tempfile.mkdtemp(prefix="boordpackhouse-tests-")
os.environ["PACKHOUSE_DATA_DIR"] = _TMP
os.environ["PACKHOUSE_DB_PATH"] = os.path.join(_TMP, "packhouse.db")
os.environ["BOORD_DB_PATH"] = os.path.join(_TMP, "boord.db")
os.environ["BOORD_URL"] = "http://127.0.0.1:9"  # nothing there: weather is {}
os.environ["TZ"] = "Africa/Johannesburg"
time.tzset()

import pytest  # noqa: E402


def _utc(days_ago: int) -> str:
    """Naive UTC, as Boord stores it: noon farm time, `days_ago` days back."""
    local_noon = datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)
    return (local_noon - timedelta(days=days_ago)).astimezone(timezone.utc).replace(tzinfo=None).isoformat(" ")


def _build_fake_boord_db():
    """Just the columns boord.py reads. Received: today, own fruit from
    blocks 15 and 8a plus a bought-in lot; 2 days ago, block 7; 5 days ago,
    block 9 (older than the last previous receiving day, so never offered)."""
    con = sqlite3.connect(os.environ["BOORD_DB_PATH"])
    con.executescript("""
        CREATE TABLE worker (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, name TEXT,
                             photo_filename TEXT, active BOOLEAN);
        CREATE TABLE block (id TEXT PRIMARY KEY, name TEXT, variety TEXT);
        CREATE TABLE supplier (id INTEGER PRIMARY KEY, name TEXT, is_own_farm BOOLEAN);
        CREATE TABLE lot (id INTEGER PRIMARY KEY, supplier_id INTEGER, total_crates INTEGER,
                          status TEXT, received_at DATETIME);
        CREATE TABLE harvestrecord (uuid TEXT PRIMARY KEY, lot_id INTEGER, block_id TEXT);
        INSERT INTO worker VALUES ('001', 'Thandi', 'M', 'Thandi M', '', 1),
                                  ('002', 'Piet', 'K', '', '002.jpg', 1),
                                  ('003', '', '', 'Gone', '', 0);
        INSERT INTO block VALUES ('15', 'Block 15', 'Early Delight'), ('8a', 'Block 8a', 'Third Month Red'),
                                 ('7', 'Block 7', 'Early Delight'), ('9', 'Block 9', 'Early Delight');
        INSERT INTO supplier VALUES (1, 'Own fruit', 1), (2, 'Jansen Boerdery', 0);
    """)
    lots = [(1, 1, 4, "received", _utc(0)), (2, 2, 40, "received", _utc(0)),
            (3, 1, 2, "received", _utc(2)), (4, 1, 1, "received", _utc(5)),
            (5, 1, 9, "in_transit", None)]
    con.executemany("INSERT INTO lot VALUES (?, ?, ?, ?, ?)", lots)
    crates = [("15", 1)] * 3 + [("8a", 1)] + [("7", 3)] * 2 + [("9", 4)] + [("15", 5)] * 9
    con.executemany("INSERT INTO harvestrecord VALUES (?, ?, ?)",
                    [(f"h{i}", lot, block) for i, (block, lot) in enumerate(crates)])
    con.commit()
    con.close()


_build_fake_boord_db()


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    import admin_auth
    import main

    # https, because the settings cookie is Secure and httpx will not send a
    # Secure cookie back over plain http.
    from sqlmodel import Session, delete, select

    from db import packhouse_engine
    from models import (AcidBatch, Bath, BathCheck, ChemicalChange, Consignment, DeliveryNote, Market, Packaging, Pallet,
                        SulfurRun, SulfurSettings, Tent)

    with TestClient(main.app, base_url="https://testserver") as c:
        with Session(packhouse_engine) as s:
            s.exec(delete(SulfurRun))
            s.exec(delete(SulfurSettings))
            s.add(SulfurSettings(id=1))  # the model's defaults are the seeded numbers
            # Back to the four seeded tents, as the migration made them.
            s.exec(delete(Tent).where(Tent.id > 4))
            for i, letter in enumerate("ABCD"):
                t = s.get(Tent, i + 1)
                t.name, t.active, t.sort, t.default_grams, t.default_minutes, t.default_crates = (
                    f"Tent {letter}", True, i, 425.0, 60, 24)
                s.add(t)
            for model in (AcidBatch, ChemicalChange, BathCheck, Pallet, Consignment, DeliveryNote):
                s.exec(delete(model))
            # Back to the two seeded baths.
            s.exec(delete(Bath).where(Bath.id > 2))
            for n in (1, 2):
                b = s.get(Bath, n)
                b.name, b.active, b.sort, b.default_dip_minutes, b.default_dry_minutes = f"Bath {n}", True, n - 1, 5, 30
                b.default_crates, b.change_days, b.change_crates = 24, 3.5, 500
                s.add(b)
            # Back to the seeded markets and packs.
            s.exec(delete(Market).where(Market.id > 5))
            s.exec(delete(Packaging).where(Packaging.id > 4))
            for m in s.exec(select(Market)).all():
                m.active = True
                s.add(m)
            s.commit()
        if os.path.exists(admin_auth.PIN_FILE):
            os.remove(admin_auth.PIN_FILE)
        admin_auth._failures, admin_auth._locked_until = 0, 0.0
        yield c


ADMIN_PIN = "4321"


@pytest.fixture
def admin_client(client):
    import admin_auth
    admin_auth.set_pin(ADMIN_PIN)
    assert client.post("/api/admin/login", json={"pin": ADMIN_PIN}).status_code == 200
    return client
