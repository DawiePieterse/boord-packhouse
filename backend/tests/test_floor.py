"""What the floor tablets cache: workers, fruit sources, tents."""


def test_workers_are_boords_active_ones(client):
    assert client.get("/api/workers").json() == [
        {"id": "001", "name": "Thandi M", "photo": ""},
        {"id": "002", "name": "Piet K", "photo": "/photos/002.jpg"},
    ]


def test_fruit_sources_today_then_the_last_previous_day(client):
    groups = client.get("/api/fruit-sources").json()
    assert [g["label"] for g in groups][0] == "Today"
    assert len(groups) == 2  # the 5-days-ago lot is not offered
    today = {s["key"]: s for s in groups[0]["sources"]}
    assert today["block:15"]["crates"] == 3 and today["block:15"]["variety"] == "Early Delight"
    assert today["block:8a"]["crates"] == 1
    assert today["supplier:2"] == {"key": "supplier:2", "supplier_id": 2,
                                   "supplier_name": "Jansen Boerdery", "crates": 40, "crate_kg": 19.0}
    assert today["block:15"]["crate_kg"] == 20.0
    assert [s["key"] for s in groups[1]["sources"]] == ["block:7"]
    # The lot still on the truck is not received fruit.
    assert all(s["crates"] < 9 or s["key"] == "supplier:2" for s in groups[0]["sources"])


def test_tents_lists_active_ones_in_order(client):
    assert [t["name"] for t in client.get("/api/tents").json()] == ["Tent A", "Tent B", "Tent C", "Tent D"]
