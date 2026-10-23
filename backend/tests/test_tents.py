"""Settings -> Tents, behind the PIN."""


def test_tent_settings_need_the_pin(client):
    assert client.get("/api/settings/tents").status_code == 401
    assert client.post("/api/settings/tents", json={"name": "Tent E"}).status_code == 401
    assert client.put("/api/settings/tents/1", json={"name": "X"}).status_code == 401


def test_add_rename_and_retire(admin_client):
    e = admin_client.post("/api/settings/tents", json={"name": " Tent E ", "default_grams": 400,
                                                        "default_minutes": 45, "default_crates": 20}).json()
    assert e["name"] == "Tent E" and e["sort"] == 4
    admin_client.put("/api/settings/tents/1", json={"name": "Big tent", "default_grams": 425,
                                                     "default_minutes": 60, "default_crates": 24})
    admin_client.put("/api/settings/tents/2", json={"name": "Tent B", "active": False})
    names = [t["name"] for t in admin_client.get("/api/tents").json()]
    assert names == ["Big tent", "Tent C", "Tent D", "Tent E"]
    assert len(admin_client.get("/api/settings/tents").json()) == 5  # retired still listed here


def test_tent_values_are_checked(admin_client):
    assert admin_client.post("/api/settings/tents", json={"name": " "}).status_code == 422
    assert admin_client.post("/api/settings/tents", json={"name": "T", "default_minutes": 0}).status_code == 422
