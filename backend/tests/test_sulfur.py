"""Sulfur runs: an idempotent, offline-safe sync."""
from datetime import datetime, timedelta, timezone

import pytest

import routers.sulfur as sulfur


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def run(uuid="r1", started=None, **kw):
    body = {"uuid": uuid, "tent_id": 1, "tent_name": "Tent A", "grams": 425, "minutes": 60,
            "crates": 24, "block_id": "15", "block_name": "Block 15", "variety": "Early Delight",
            "started_at": _iso(started or datetime.now(timezone.utc)),
            "started_by": "001", "started_by_name": "Thandi M"}
    body.update(kw)
    return body


def sync(client, *runs):
    r = client.post("/api/sulfur/sync", json={"device": "tablet-1", "runs": list(runs)})
    assert r.status_code == 200
    return r.json()


def test_sync_is_idempotent_and_returns_server_time(client):
    first = sync(client, run())
    again = sync(client, run())
    assert first["synced"] == again["synced"] == ["r1"]
    assert datetime.fromisoformat(first["server_now"].replace("Z", "+00:00"))
    runs = client.get("/api/sulfur/runs").json()["runs"]
    assert len(runs) == 1 and runs[0]["device"] == "tablet-1" and runs[0]["ended_at"] is None


def test_the_tablets_start_time_is_kept(client):
    started = datetime.now(timezone.utc) - timedelta(minutes=47)  # started offline
    sync(client, run(started=started))
    stored = client.get("/api/sulfur/runs").json()["runs"][0]["started_at"]
    assert stored == _iso(started.replace(tzinfo=None).replace(tzinfo=timezone.utc))


def test_ending_is_one_way(client):
    sync(client, run())
    end = datetime.now(timezone.utc)
    sync(client, run(ended_at=_iso(end), ended_by="002", ended_by_name="Piet K"))
    # An old copy without the end, then a later end, change nothing.
    sync(client, run())
    sync(client, run(ended_at=_iso(end + timedelta(minutes=5)), ended_by="001"))
    r = client.get("/api/sulfur/runs").json()["runs"][0]
    assert r["ended_by"] == "002" and r["ended_at"].startswith(_iso(end)[:19])


@pytest.mark.parametrize("bad", [
    {"tent_id": 99}, {"crates": 0}, {"grams": 0}, {"minutes": 0},
    {"block_id": None},                       # neither a block nor a supplier
    {"supplier_id": 2, "supplier_name": "Jansen"},  # both
])
def test_bad_runs_are_rejected_not_stored(client, bad):
    out = sync(client, run(**bad))
    assert out["synced"] == [] and out["rejected"][0]["uuid"] == "r1"
    assert client.get("/api/sulfur/runs").json()["runs"] == []


def test_bought_in_fruit_is_by_supplier(client):
    sync(client, run(block_id=None, block_name="", variety="", supplier_id=2, supplier_name="Jansen Boerdery"))
    r = client.get("/api/sulfur/runs").json()["runs"][0]
    assert r["supplier_name"] == "Jansen Boerdery" and r["block_id"] is None


def test_weather_only_on_a_fresh_run(client, monkeypatch):
    monkeypatch.setattr(sulfur, "farm_weather", lambda timeout: {"temp": 27.5, "humidity": 40})
    sync(client, run("fresh"), run("stale", started=datetime.now(timezone.utc) - timedelta(hours=2)))
    by = {r["uuid"]: r for r in client.get("/api/sulfur/runs").json()["runs"]}
    assert by["fresh"]["weather_temp"] == 27.5 and by["fresh"]["weather_humidity"] == 40
    assert by["stale"]["weather_temp"] is None


def test_runs_lists_running_and_recently_finished(client):
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=3)
    sync(client,
         run("running-long", started=old),                                      # still going: listed
         run("old-done", started=old, ended_at=_iso(old + timedelta(hours=1))),  # finished long ago: not
         run("done-today", started=now - timedelta(hours=2), ended_at=_iso(now)))
    uuids = {r["uuid"] for r in client.get("/api/sulfur/runs").json()["runs"]}
    assert uuids == {"running-long", "done-today"}


def test_an_end_before_the_start_is_kept_at_the_start(client):
    now = datetime.now(timezone.utc)
    sync(client, run(started=now, ended_at=_iso(now - timedelta(seconds=30)), ended_by="002"))
    r = client.get("/api/sulfur/runs").json()["runs"][0]
    assert r["ended_at"] == r["started_at"] and r["ended_by"] == "002"
