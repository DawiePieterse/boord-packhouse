import re


def test_home_page_is_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Boord Packhouse" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_version_has_the_fields_monitor_reads(client):
    body = client.get("/api/version").json()
    assert body["app"] == "Boord Packhouse"
    assert {"tag", "state", "frontend_version"} <= body.keys()
    assert re.fullmatch(r"\d+(\.\d+)*", body["frontend_version"])
