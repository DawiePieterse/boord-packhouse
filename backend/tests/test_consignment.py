"""Consignments and pallets: the sulfur runs' idempotent sync, with editable
pallets, a server-given pallet number (0001 each year) and a unique barcode."""
from datetime import datetime, timezone

import pytest


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


NOW = datetime.now(timezone.utc)
LINE = {"packaging_id": 1, "packaging_name": "Pre-pac", "carton_kg": 0.48, "cartons": 60}


def cons(uuid="c1"):
    return {"uuid": uuid, "created_at": _iso(NOW)}


def pallet(uuid="p1", barcode="(00)060099005963004759", lines=None, **kw):
    return {"uuid": uuid, "consignment_uuid": "c1", "barcode": barcode, "scanned_at": _iso(NOW),
            "pallet_ref": "00" + uuid[-1], "supplier_id": 1, "supplier_name": "Own fruit",
            "market_id": 1, "market_name": "USA Sea Freight", "lines": [LINE] if lines is None else lines, **kw}


def sync(client, consignments=(), pallets=()):
    r = client.post("/api/consignment/sync", json={"device": "phone-1", "consignments": list(consignments),
                                                   "pallets": list(pallets)})
    assert r.status_code == 200
    return r.json()


def state(client):
    return client.get("/api/consignment/state").json()


def test_sync_is_idempotent_and_numbers_pallets_once(client):
    out = sync(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2")])
    assert out["synced"] == ["c1", "p1", "p2"] and out["rejected"] == []
    sync(client, [cons()], [pallet("p1"), pallet("p2", barcode="B2")])
    pallets = state(client)["pallets"]
    assert [(p["pallet_year"], p["pallet_no"]) for p in pallets] == [(NOW.astimezone().year, 1), (NOW.astimezone().year, 2)]
    assert len(state(client)["consignments"]) == 1


def test_a_pallet_can_be_edited_but_keeps_its_number(client):
    sync(client, [cons()], [pallet()])
    sync(client, pallets=[pallet(barcode="NEW", market_id=5, market_name="Local", supplier_id=2,
                                 supplier_name="Jansen Boerdery", lines=[{**LINE, "cartons": 61}])])
    p = state(client)["pallets"][0]
    assert p["pallet_no"] == 1 and p["barcode"] == "NEW" and p["lines"][0]["cartons"] == 61
    assert (p["market_name"], p["supplier_id"], p["supplier_name"]) == ("Local", 2, "Jansen Boerdery")


def test_barcode_is_unique_until_the_pallet_is_removed(client):
    sync(client, [cons()], [pallet("p1")])
    out = sync(client, pallets=[pallet("p2")])
    assert out["synced"] == [] and "already on pallet" in out["rejected"][0]["error"]
    sync(client, pallets=[pallet("p1", removed=True)])
    assert [(p["uuid"], p["removed"]) for p in state(client)["pallets"]] == [("p1", True)]  # sent, so other phones drop it
    assert sync(client, pallets=[pallet("p2")])["synced"] == ["p2"]
    assert state(client)["pallets"][1]["pallet_no"] == 2  # p1's number is not reused


@pytest.mark.parametrize("bad", [
    {"consignment_uuid": "nope"}, {"lines": []},
    {"pallet_ref": ""}, {"pallet_ref": "12"}, {"pallet_ref": "1234"}, {"pallet_ref": "12a"},
    {"supplier_id": None}, {"market_id": None}, {"market_id": 99},
    {"lines": [{**LINE, "cartons": 0}]}, {"lines": [{**LINE, "carton_kg": 0}]}, {"lines": [{**LINE, "packaging_name": ""}]},
])
def test_bad_pallets_are_rejected_not_stored(client, bad):
    out = sync(client, [cons()], [pallet(**bad)])
    assert out["rejected"][0]["uuid"] == "p1"
    assert state(client)["pallets"] == []


def test_suppliers_come_from_boord_own_farm_first(client):
    assert client.get("/api/suppliers").json() == [
        {"id": 1, "name": "Own fruit", "is_own_farm": True}, {"id": 2, "name": "Jansen Boerdery", "is_own_farm": False}]


def test_pallet_number_is_unique_for_the_season_across_stacks(client):
    sync(client, [cons(), cons("c2")], [pallet("p1")])
    out = sync(client, pallets=[{**pallet("p3", barcode="B3", pallet_ref="001"), "consignment_uuid": "c2"}])
    assert "already used this season" in out["rejected"][0]["error"]
    # a number can be edited, e.g. to start at 100 and go on from there
    assert sync(client, pallets=[pallet("p1", pallet_ref="100"), pallet("p2", barcode="B2", pallet_ref="101")])["synced"] == ["p1", "p2"]
    assert [p["pallet_ref"] for p in state(client)["pallets"]] == ["100", "101"]
    # a pallet taken off frees its number
    sync(client, pallets=[pallet("p1", removed=True)])
    assert sync(client, pallets=[pallet("p4", barcode="B4", pallet_ref="100")])["synced"] == ["p4"]


def test_each_line_keeps_its_block_and_the_date_code_is_kept(client):
    lines = [{**LINE, "block_id": "15", "block_name": "Block 15", "variety": "Early Delight"},
             {**LINE, "packaging_name": "1kg XXL", "block_id": "7", "block_name": "Block 7", "variety": ""},
             {**LINE, "block_id": None}]  # a block is optional
    sync(client, [cons()], [pallet(lines=lines, date_code="4104")])
    p = state(client)["pallets"][0]
    assert [l["block_id"] for l in p["lines"]] == ["15", "7", None] and p["date_code"] == "4104"


def test_a_stack_is_only_its_uuid_and_date(client):
    sync(client, [cons()])
    assert set(state(client)["consignments"][0]) == {"uuid", "created_at", "device", "synced_at"}


def test_settings_need_the_pin_and_floor_lists_do_not(client, admin_client):
    admin_client.post("/api/admin/logout")
    assert client.get("/api/settings/packaging").status_code == 401
    assert client.get("/api/settings/markets").status_code == 401
    assert client.post("/api/settings/packaging", json={"name": "x", "carton_kg": 1}).status_code == 401
    assert [m["name"] for m in client.get("/api/markets").json()][:2] == ["USA Sea Freight", "USA Air Freight"]
    assert client.get("/api/packaging").json()[0]["carton_kg"] == 0.48


def test_packs_come_lightest_first(client, admin_client):
    admin_client.post("/api/settings/packaging", json={"name": "Heavy 9 kg", "carton_kg": 9})
    admin_client.post("/api/settings/packaging", json={"name": "Light 0.2 kg", "carton_kg": 0.2})
    for path in ("/api/packaging", "/api/settings/packaging"):
        kg = [p["carton_kg"] for p in admin_client.get(path).json()]
        assert kg == sorted(kg) and kg[0] == 0.2 and kg[-1] == 9


def test_settings_add_edit_retire(admin_client):
    r = admin_client.post("/api/settings/packaging", json={"name": "500g", "carton_kg": 0.55})
    assert r.status_code == 200 and r.json()["sort"] == 4
    admin_client.put(f"/api/settings/packaging/{r.json()['id']}", json={"name": "500g", "carton_kg": 0.55, "active": False})
    assert "500g" not in [p["name"] for p in admin_client.get("/api/packaging").json()]
    assert admin_client.post("/api/settings/packaging", json={"name": "x", "carton_kg": 0}).status_code == 422
    assert admin_client.post("/api/settings/markets", json={"name": " "}).status_code == 422
    m = admin_client.post("/api/settings/markets", json={"name": "Middle East"}).json()
    assert m["sort"] == 5 and admin_client.put("/api/settings/markets/99", json={"name": "x"}).status_code == 404


def test_delete_only_what_no_live_pallet_uses(client, admin_client):
    sync(client, [cons()], [pallet()])  # pack 1, market 1
    assert admin_client.delete("/api/settings/packaging/1").status_code == 409
    assert admin_client.delete("/api/settings/markets/1").status_code == 409
    assert admin_client.delete("/api/settings/packaging/2").status_code == 200
    assert admin_client.delete("/api/settings/markets/2").status_code == 200
    assert admin_client.delete("/api/settings/markets/2").status_code == 404
    assert 2 not in [p["id"] for p in admin_client.get("/api/settings/packaging").json()]
    sync(client, pallets=[pallet(removed=True)])  # a removed pallet no longer holds them
    assert admin_client.delete("/api/settings/packaging/1").status_code == 200
    admin_client.post("/api/admin/logout")
    assert client.delete("/api/settings/markets/1").status_code == 401


def test_who_scanned_it_stays_and_who_changed_it_follows(client):
    sync(client, [cons()], [pallet(scanned_by="W1", scanned_by_name="Thandi", changed_by="W1", changed_by_name="Thandi")])
    sync(client, pallets=[pallet(scanned_by="W2", scanned_by_name="Sipho", changed_by="W2", changed_by_name="Sipho")])
    p = state(client)["pallets"][0]
    assert (p["scanned_by"], p["scanned_by_name"], p["changed_by_name"]) == ("W1", "Thandi", "Sipho")
    sync(client, pallets=[pallet(removed=True, changed_by="W3", changed_by_name="Lerato")])
    assert state(client)["pallets"][0]["changed_by_name"] == "Lerato"


def test_the_barcode_is_optional(client):
    out = sync(client, [cons()], [pallet("p1", barcode=""), pallet("p2", barcode="  ")])
    assert out["synced"] == ["c1", "p1", "p2"]  # two pallets without one: no clash
    assert [p["barcode"] for p in state(client)["pallets"]] == ["", ""]
