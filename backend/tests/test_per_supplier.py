"""Pallet Stack, Delivery Note and Juice per supplier: each supplier's pallets,
bins and notes numbered on their own, a note holding one supplier's fruit, and
its documents printing that supplier's details from Boord."""
import json
import os
import sqlite3
from datetime import datetime
from io import BytesIO

import pytest

from tests.test_consignment import cons, pallet
from tests.test_consignment import sync as sync_pallets
from tests.test_delivery_note import note, notes
from tests.test_delivery_note import sync as sync_notes
from tests.test_juice import bins, jbin
from tests.test_juice import sync as sync_bins

JANSEN = {"supplier_id": 2, "supplier_name": "Jansen Boerdery"}


@pytest.fixture
def jansen_details():
    """Boord 3.67's supplier columns, filled in for Jansen; taken away again after."""
    cols = ("puc", "global_gap_number", "document_name", "reg_number", "document_contact", "document_address", "note_prefix")
    con = sqlite3.connect(os.environ["BOORD_DB_PATH"])
    for c in cols:
        con.execute(f"ALTER TABLE supplier ADD COLUMN {c} TEXT NOT NULL DEFAULT ''")
    con.execute("UPDATE supplier SET puc = 'K 1234', global_gap_number = '4049928123456', "
                "document_name = 'Jansen Boerdery (Pty) Ltd', reg_number = 'Reg No 2001/012345/07', "
                "document_contact = 'Tel: 082 555 1234\nEmail: piet@jansen.example', "
                "document_address = 'Posbus 7\nKomatipoort\n1340', note_prefix = 'JB' WHERE id = 2")
    con.commit()
    yield
    for c in cols:
        con.execute(f"ALTER TABLE supplier DROP COLUMN {c}")
    con.commit()
    con.close()


def test_each_supplier_numbers_its_own_pallets(client):
    out = sync_pallets(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2", pallet_ref="001", **JANSEN),
                                         pallet("p3", barcode="B3", pallet_ref="001", **JANSEN)])
    assert out["synced"] == ["c1", "p1", "p2"]
    assert "already used this season" in out["rejected"][0]["error"]


def test_each_supplier_numbers_its_own_bins_and_a_bin_keeps_its_supplier(client):
    out = sync_bins(client, jbin(), jbin("b2", **JANSEN), jbin("b3", **JANSEN))
    assert out["synced"] == ["b1", "b2"] and "already used" in out["rejected"][0]["error"]
    sync_bins(client, jbin("b2", supplier_id=1, supplier_name="Own fruit", full_kg=510))  # set once
    by = {b["uuid"]: b for b in bins(client)}
    # A bin from a phone that does not say whose it is is the farm's own.
    assert (by["b1"]["supplier_id"], by["b1"]["supplier_name"]) == (1, "Own fruit")
    assert (by["b2"]["supplier_id"], by["b2"]["supplier_name"], by["b2"]["full_kg"]) == (2, "Jansen Boerdery", 510)


def test_each_supplier_has_its_own_note_numbers_and_only_its_own_fruit(client):
    sync_pallets(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2", pallet_ref="001", **JANSEN),
                                    pallet("p3", barcode="B3", market_id=5, market_name="Local")])
    sync_bins(client, jbin("b2", **JANSEN))
    assert sync_notes(client, note(), note("n2", pallets=("p2",), supplier_id=2))["rejected"] == []
    out = sync_notes(client, note("n3", 1336, pallets=("p3", "p2")), note("n4", 1, pallets=(), bins=[{"uuid": "b2"}]),
                     note("n5", 1335, pallets=("p3",)))
    assert [("Jansen" in r["error"], "already used" in r["error"]) for r in out["rejected"]] == [(True, False), (True, False), (False, True)]
    by = {n["uuid"]: n for n in notes(client)}
    assert (by["n1"]["supplier_id"], by["n1"]["supplier"]["name"], by["n2"]["supplier"]["name"]) == (1, "Own fruit", "Jansen Boerdery")
    sync_notes(client, note("n4", 1, pallets=(), bins=[{"uuid": "b2"}], supplier_id=2))
    opts = client.get("/api/deliverynote/options").json()
    assert (opts["last_no"], opts["last_juice_no"]) == (1335, 0)  # the farm's own, as before
    assert opts["last_nos"] == {"1": {"no": 1335, "juice": 0}, "2": {"no": 1335, "juice": 1}}
    # Only the farm's own notes move Settings' last number.
    out = sync_notes(client, note("n2", removed=True, supplier_id=2), note("n6", 2000, pallets=("p2",), supplier_id=2))
    assert out["rejected"] == [] and client.get("/api/deliverynote/options").json()["last_no"] == 1335


def test_the_number_and_the_details_are_the_suppliers(client):
    from export_forms import OWN, note_label, sender
    from models import DeliveryNote

    def a_note(supplier, market="Local", bins="[]"):
        return DeliveryNote(uuid="x", note_no=12, created_at=datetime.now(), bins=bins, supplier=json.dumps(supplier),
                            pallets=json.dumps([{"market_name": market}]))
    full = '[{"uuid": "b"}]'
    own, plain, named = {"id": 1, "name": "Own fruit", "is_own_farm": True}, {"id": 3, "name": "Nel"}, {"id": 2, "name": "Jansen", "note_prefix": "JB"}
    assert [note_label(a_note(s, m, b)) for s, m, b in ((own, "Local", "[]"), (own, "USA Sea", "[]"), (own, "", full), ({}, "EU Air", "[]"),
                                                       (plain, "USA Sea", "[]"), (plain, "", full), (named, "Local", "[]"), (named, "", full))] == [
        "B-12", "LW-12", "J-0012", "LW-12", "S3-12", "S3J-0012", "JB-12", "JBJ-0012"]
    # The farm's own row left blank prints what was always printed; one field filled in changes only that.
    assert {k: sender(a_note(own))[k] for k in OWN} == OWN
    assert sender(a_note({**own, "puc": "D 9999"}))["puc"] == "D9999" and sender(a_note({**own, "puc": "D 9999"}))["name"] == OWN["name"]
    assert (sender(a_note(plain))["name"], sender(a_note(plain))["puc"], sender(a_note(plain))["contact"]) == ("Nel", "", "")


def test_a_suppliers_documents_carry_its_details_from_boord(client, jansen_details):
    from openpyxl import load_workbook
    jansen = next(s for s in client.get("/api/suppliers").json() if s["id"] == 2)
    assert (jansen["puc"], jansen["document_name"], jansen["note_prefix"]) == ("K 1234", "Jansen Boerdery (Pty) Ltd", "JB")
    sync_pallets(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2", **JANSEN),
                                    pallet("p3", barcode="B3", market_id=5, market_name="Local", **JANSEN)])
    sync_notes(client, note(), note("n2", 7, pallets=("p2",), supplier_id=2), note("n3", 8, pallets=("p3",), supplier_id=2))
    r = client.get("/api/deliverynote/n2/usa_forms.xlsx")
    assert r.status_code == 200 and "usa_forms_JB-7.xlsx" in r.headers["content-disposition"]
    wb = load_workbook(BytesIO(r.content))
    p, c, ins = wb["Phyto (1)"], wb["Consignment 1"], wb["Inspection Sheet"]
    assert (p["C5"].value, p["C15"].value, p["J19"].value, p["H27"].value) == ("JB 7", "Jansen Boerdery (Pty) Ltd", "K1234", "K 1234")
    assert (c["C2"].value, c["C4"].value, c["J3"].value, c["J5"].value, c["J4"].value, ins["O9"].value) == (
        "Jansen Boerdery (Pty) Ltd", "Posbus 7, Komatipoort, 1340", "PUC Code : K1234", "GGN Nr     : 4049928123456",
        "PHC Code : D12167", "PUC : K1234")
    # The farm's own papers are untouched: the department's template as it was.
    own = load_workbook(BytesIO(client.get("/api/deliverynote/n1/usa_forms.xlsx").content))
    assert (own["Phyto (1)"]["C15"].value, own["Phyto (1)"]["J19"].value, own["Phyto (1)"]["H27"].value, own["Consignment 1"]["C2"].value,
            own["Consignment 1"]["J3"].value, own["Consignment 1"]["J5"].value, own["Inspection Sheet"]["O9"].value) == (
        "Bekfontein", "D2087", "D 2087", "Bekfontein Boerdery", "PUC Code : D2087", "GGN Nr     : 4050373828202", "PUC : D2087")
    r = client.get("/api/deliverynote/n3/pdf")
    assert r.status_code == 200 and "afleweringsnota_JB-8.pdf" in r.headers["content-disposition"]


def test_notes_and_bins_from_before_are_the_farms_own(client):
    from sqlalchemy import text

    import main
    from db import packhouse_engine
    sync_pallets(client, [cons()], [pallet("p1")])
    sync_notes(client, note())
    sync_bins(client, jbin())
    with packhouse_engine.begin() as conn:
        conn.execute(text("UPDATE deliverynote SET supplier_id = NULL, supplier = '{}'"))
        conn.execute(text("UPDATE juicebin SET supplier_id = NULL"))
    main._own_the_unowned()
    assert notes(client)[0]["supplier_id"] == 1 and bins(client)[0]["supplier_id"] == 1
    assert client.get("/api/deliverynote/n1/usa_forms.xlsx").status_code == 200  # still LW-, the farm's own
