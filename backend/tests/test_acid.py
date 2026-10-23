"""Acid bath batches, chemical changes and checks: the sulfur runs' sync,
with a batch that moves one way, dipping -> drying -> done."""
from datetime import datetime, timedelta, timezone

import pytest


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def batch(uuid="b1", started=None, **kw):
    body = {"uuid": uuid, "bath_id": 1, "bath_name": "Bath 1", "route": "export", "sulfur_run_uuid": "r1",
            "crates": 24, "dip_minutes": 5, "dry_minutes": 30,
            "block_id": "15", "block_name": "Block 15", "variety": "Early Delight",
            "started_at": _iso(started or datetime.now(timezone.utc)),
            "started_by": "001", "started_by_name": "Thandi M"}
    body.update(kw)
    return body


def sync(client, batches=(), changes=(), checks=()):
    r = client.post("/api/acid/sync", json={"device": "tablet-1", "batches": list(batches),
                                            "changes": list(changes), "checks": list(checks)})
    assert r.status_code == 200
    return r.json()


def state(client):
    return client.get("/api/acid/state").json()


def test_sync_is_idempotent(client):
    assert sync(client, [batch()])["synced"] == sync(client, [batch()])["synced"] == ["b1"]
    b = state(client)["batches"]
    assert len(b) == 1 and b[0]["device"] == "tablet-1" and b[0]["dip_ended_at"] is None


def test_each_stage_ends_once(client):
    now = datetime.now(timezone.utc)
    sync(client, [batch()])
    sync(client, [batch(dip_ended_at=_iso(now), dip_ended_by="002")])
    sync(client, [batch()])  # an old copy reopens nothing
    sync(client, [batch(dip_ended_at=_iso(now + timedelta(minutes=9)), dip_ended_by="001",
                        ended_at=_iso(now + timedelta(minutes=30)), ended_by="001")])
    b = state(client)["batches"][0]
    assert b["dip_ended_by"] == "002" and b["dip_ended_at"].startswith(_iso(now)[:19])
    assert b["ended_by"] == "001"


@pytest.mark.parametrize("bad", [
    {"bath_id": 99}, {"crates": 0}, {"dip_minutes": 0}, {"dry_minutes": 0}, {"route": "juice"},
    {"block_id": None},
    {"supplier_id": 2, "supplier_name": "Jansen"},
    {"ended_at": _iso(datetime.now(timezone.utc))},  # done without leaving the bath
])
def test_bad_batches_are_rejected_not_stored(client, bad):
    out = sync(client, [batch(**bad)])
    assert out["synced"] == [] and out["rejected"][0]["uuid"] == "b1"
    assert state(client)["batches"] == []


def test_state_is_bounded_and_counts_crates_since_the_last_change(client):
    now = datetime.now(timezone.utc)
    week = now - timedelta(days=7)
    done = {"dip_ended_at": _iso(week), "ended_at": _iso(week)}
    sync(client, [batch("before", started=week - timedelta(days=1), **done),
                  batch("after", started=week + timedelta(hours=1), crates=10, **done),
                  batch("today", started=now - timedelta(hours=1), crates=5, sulfur_run_uuid="r2"),
                  batch("other-bath", bath_id=2, started=week - timedelta(days=1), **done)],
         changes=[{"uuid": "c0", "bath_id": 1, "changed_at": _iso(week - timedelta(days=4))},
                  {"uuid": "c1", "bath_id": 1, "changed_at": _iso(week), "crates_since": 24, "by": "002"}],
         checks=[{"uuid": "k1", "bath_id": 1, "checked_at": _iso(now), "value": 1.8, "by": "001"}])
    s = state(client)
    # Only what is still going or from the last day, whatever the changes.
    assert {b["uuid"] for b in s["batches"]} == {"today"}
    assert [c["uuid"] for c in s["changes"]] == ["c1"]
    assert s["checks"][0]["value"] == 1.8
    # Bath 1 counts from its last change; bath 2 never changed: all of it.
    assert {h["bath_id"]: (h["crates"], h["change_uuid"]) for h in s["health"]} == {1: (15, "c1"), 2: (24, None)}
    # "before" and "after" were dipped over a week ago: outside the window.
    assert s["used_runs"] == ["r2"]


def test_used_runs_include_retired_baths(admin_client):
    sync(admin_client, [batch("b2", bath_id=2, sulfur_run_uuid="r9")])
    admin_client.put("/api/settings/baths/2", json={"name": "Bath 2", "active": False})
    s = state(admin_client)
    assert s["batches"] == [] and s["used_runs"] == ["r9"]


def test_a_stage_never_ends_before_the_one_before(client):
    now = datetime.now(timezone.utc)
    sync(client, [batch(started=now, dip_ended_at=_iso(now - timedelta(seconds=20)), dip_ended_by="002")])
    sync(client, [batch(started=now, dip_ended_at=_iso(now + timedelta(minutes=5)),
                        ended_at=_iso(now - timedelta(minutes=1)), ended_by="001")])
    b = state(client)["batches"][0]
    assert b["dip_ended_at"] == b["started_at"] and b["ended_at"] == b["dip_ended_at"]


def test_bath_settings_need_the_pin(client):
    assert client.get("/api/settings/baths").status_code == 401
    assert client.post("/api/settings/baths", json={"name": "Bath 3"}).status_code == 401


def test_add_and_retire_a_bath(admin_client):
    three = admin_client.post("/api/settings/baths", json={"name": " Bath 3 ", "change_days": 4}).json()
    assert three["name"] == "Bath 3" and three["sort"] == 2 and three["change_crates"] == 500
    admin_client.put("/api/settings/baths/2", json={"name": "Bath 2", "active": False})
    assert [b["name"] for b in admin_client.get("/api/baths").json()] == ["Bath 1", "Bath 3"]
    assert admin_client.post("/api/settings/baths", json={"name": "X", "change_crates": 0}).status_code == 422
