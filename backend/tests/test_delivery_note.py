"""Delivery notes: the pallets' editable sync, a number unique among live
notes, and the paper note as a PDF."""
from datetime import datetime, timezone

import pytest

NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def note(uuid="n1", note_no=1335, **kw):
    return {"uuid": uuid, "note_no": note_no, "created_at": NOW, "receiver": "Boeretrust\nTshwane Mark\nPretoria",
            "transporter": "Go Fresh", "loaded_on": "2026-10-26", "offloaded_on": "2026-10-27",
            "lines": [{"count": 60, "description": "Prepac TMR Litchis"}], **kw}


def sync(client, *notes):
    r = client.post("/api/deliverynote/sync", json={"device": "phone-1", "notes": list(notes)})
    assert r.status_code == 200
    return r.json()


def notes(client):
    return client.get("/api/deliverynote/state").json()["notes"]


def test_sync_is_idempotent_and_editable_and_keeps_who_made_it(client):
    assert sync(client, note(made_by="W1", made_by_name="Thandi"))["synced"] == ["n1"]
    sync(client, note(seal_no="S9", made_by="W2", made_by_name="Sipho", changed_by_name="Sipho"))
    [n] = notes(client)
    assert (n["seal_no"], n["made_by_name"], n["changed_by_name"]) == ("S9", "Thandi", "Sipho")
    assert n["lines"] == [{"count": 60, "description": "Prepac TMR Litchis"}]


def test_number_is_unique_until_the_note_is_removed(client):
    sync(client, note())
    assert "already used" in sync(client, note("n2"))["rejected"][0]["error"]
    sync(client, note(removed=True))
    assert sync(client, note("n2"))["synced"] == ["n2"]


@pytest.mark.parametrize("bad", [
    {"note_no": 0}, {"receiver": " "}, {"loaded_on": ""}, {"offloaded_on": "27/10"}, {"lines": []},
    {"lines": [{"count": 0, "description": "x"}]}, {"lines": [{"count": 5, "description": " "}]},
])
def test_bad_notes_are_rejected_not_stored(client, bad):
    assert sync(client, note(**bad))["rejected"][0]["uuid"] == "n1"
    assert notes(client) == []


def test_pdf_is_the_paper_note(client):
    sync(client, note(receiver="Laughing Waters Lietsjies", cooled_to="5"))
    r = client.get("/api/deliverynote/n1/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert "afleweringsnota_1335.pdf" in r.headers["content-disposition"]
    assert client.get("/api/deliverynote/nope/pdf").status_code == 404
