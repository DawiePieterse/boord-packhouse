"""Delivery notes: the pallets' editable sync, a number unique among live
notes, the Pallet Stack pallets on it (a copy of each, each on one note), the
settings it picks from, and the paper note as a PDF."""
from datetime import datetime, timezone

import pytest

from tests.test_consignment import cons, pallet
from tests.test_consignment import sync as sync_pallets

NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def note(uuid="n1", note_no=1335, pallets=("p1",), **kw):
    return {"uuid": uuid, "note_no": note_no, "created_at": NOW, "receiver_id": 2,
            "receiver": "Boeretrust\nTshwane Mark\nPretoria", "transporter_id": 2, "transporter": "Go Fresh",
            "loaded_on": "2026-10-26", "offloaded_on": "2026-10-27", "pallets": [{"uuid": u} for u in pallets], **kw}


def sync(client, *notes):
    r = client.post("/api/deliverynote/sync", json={"device": "phone-1", "notes": list(notes)})
    assert r.status_code == 200
    return r.json()


def notes(client):
    return client.get("/api/deliverynote/state").json()["notes"]


@pytest.fixture
def pallets(client):
    sync_pallets(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2")])


def test_sync_is_idempotent_and_editable_and_keeps_who_made_it(client, pallets):
    assert sync(client, note(made_by="W1", made_by_name="Thandi"))["synced"] == ["n1"]
    sync(client, note(seal_no="S9", made_by="W2", made_by_name="Sipho", changed_by_name="Sipho"))
    [n] = notes(client)
    assert (n["seal_no"], n["made_by_name"], n["changed_by_name"], n["receiver_id"]) == ("S9", "Thandi", "Sipho", 2)


def test_the_note_keeps_its_own_copy_of_each_pallet(client, pallets):
    sync(client, note(pallets=("p1", "p2")))
    sync_pallets(client, pallets=[pallet("p1", supplier_name="Changed later")])
    [p1, p2] = notes(client)[0]["pallets"]
    assert (p1["pallet_ref"], p1["supplier_name"], p1["lines"][0]["cartons"]) == ("001", "Own fruit", 60)
    assert (p2["uuid"], p2["barcode"], p2["market_name"]) == ("p2", "B2", "USA Sea Freight")


def test_a_pallet_is_on_one_live_note(client, pallets):
    sync(client, note())
    assert "already on note 1335" in sync(client, note("n2", 1336))["rejected"][0]["error"]
    sync(client, note(removed=True))
    assert sync(client, note("n2", 1336))["synced"] == ["n2"]


def test_number_is_unique_until_the_note_is_removed(client, pallets):
    sync(client, note())
    assert "already used" in sync(client, note("n2", pallets=("p2",)))["rejected"][0]["error"]
    sync(client, note(removed=True))
    assert sync(client, note("n2", pallets=("p2",)))["synced"] == ["n2"]


@pytest.mark.parametrize("bad", [
    {"note_no": 0}, {"receiver": " "}, {"loaded_on": ""}, {"offloaded_on": "27/10"}, {"pallets": ()},
    {"pallets": ("nope",)}, {"pallets": ("p1", "p1")},
])
def test_bad_notes_are_rejected_not_stored(client, pallets, bad):
    assert sync(client, note(**bad))["rejected"][0]["uuid"] == "n1"
    assert notes(client) == []


def test_pdf_is_the_paper_note(client, pallets):
    sync(client, note(pallets=("p1", "p2"), cooled_to="8"))
    r = client.get("/api/deliverynote/n1/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert "afleweringsnota_1335.pdf" in r.headers["content-disposition"]
    assert client.get("/api/deliverynote/nope/pdf").status_code == 404


def test_options_come_from_settings_which_need_the_pin(client, admin_client):
    o = client.get("/api/deliverynote/options").json()
    assert ([t["name"] for t in o["transporters"]], o["cooled_to"], o["last_no"]) == (["Self", "Go Fresh"], 8.0, None)
    assert (o["receivers"][1]["market"], o["receivers"][1]["city"]) == ("Tshwane Mark", "Pretoria")
    r = admin_client.post("/api/settings/receivers", json={"name": " Dapper ", "market": "Joburg Mark", "city": "Johannesburg"})
    assert r.json()["name"] == "Dapper"
    admin_client.put("/api/settings/transporters/1", json={"name": "Self", "active": False})
    assert admin_client.put("/api/settings/deliverynote", json={"cooled_to": 5}).json()["cooled_to"] == 5
    assert admin_client.put("/api/settings/deliverynote", json={"cooled_to": 99}).status_code == 422
    o = client.get("/api/deliverynote/options").json()
    assert ([t["name"] for t in o["transporters"]], len(o["receivers"]), o["cooled_to"]) == (["Go Fresh"], 3, 5)
    admin_client.post("/api/admin/logout")
    assert client.get("/api/settings/receivers").status_code == 401
    assert client.put("/api/settings/deliverynote", json={"cooled_to": 5}).status_code == 401


def test_delete_only_what_no_live_note_uses(client, admin_client, pallets):
    sync(client, note())  # receiver 2, transporter 2
    assert admin_client.delete("/api/settings/receivers/2").status_code == 409
    assert admin_client.delete("/api/settings/transporters/2").status_code == 409
    assert admin_client.delete("/api/settings/transporters/1").status_code == 200
    sync(client, note(removed=True))
    assert admin_client.delete("/api/settings/receivers/2").status_code == 200


def test_last_number_follows_notes_and_settings_can_change_it(client, admin_client, pallets):
    last = lambda: client.get("/api/deliverynote/options").json()["last_no"]  # noqa: E731
    sync(client, note())
    assert last() == 1335
    # Mistyped 13350 then corrected: Settings sets it back, a lower note never pulls it down.
    assert admin_client.put("/api/settings/deliverynote", json={"cooled_to": 8, "last_no": 1340}).status_code == 200
    assert last() == 1340
    sync(client, note("n2", 1336, pallets=("p2",)))
    assert last() == 1340
    sync(client, note("n2", 1341, pallets=("p2",)))
    assert last() == 1341
    assert admin_client.put("/api/settings/deliverynote", json={"cooled_to": 8, "last_no": 0}).status_code == 422
    admin_client.put("/api/settings/deliverynote", json={"cooled_to": 8, "last_no": None})
    assert last() == 1341  # cleared: the highest note ever used


def test_usa_papers_list_every_pallet_line(client, pallets):
    from io import BytesIO

    from openpyxl import load_workbook
    sync(client, note(pallets=("p1", "p2")))
    r = client.get("/api/deliverynote/n1/usa.xlsx")
    assert r.status_code == 200 and 'usa_1335.xlsx' in r.headers["content-disposition"]
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["Phyto", "Consignment", "Inspection Sheet"]
    rows = [row for row in wb["Phyto"].iter_rows(values_only=True) if row[0] in (1, 2)]
    assert [(row[1], row[2], row[8]) for row in rows] == [("060099005963004759", "D2087", "001"), ("B2", "D2087", "002")]
    assert client.get("/api/deliverynote/nope/usa.xlsx").status_code == 404
