"""Juice bins: weighed empty, then full, a number unique in the season, and
the full bins on a J- delivery note in place of pallets."""
import pytest

from tests.test_delivery_note import NOW, note, notes
from tests.test_delivery_note import sync as sync_notes


def jbin(uuid="b1", bin_no=88, **kw):
    return {"uuid": uuid, "bin_no": bin_no, "weighed_at": NOW, "empty_kg": 37, "full_kg": 503, **kw}


def sync(client, *bins):
    r = client.post("/api/juice/sync", json={"device": "phone-1", "bins": list(bins)})
    assert r.status_code == 200
    return r.json()


def bins(client):
    return client.get("/api/juice/state").json()["bins"]


def test_weighed_empty_then_full_keeps_who_made_it(client):
    sync(client, jbin(full_kg=None, made_by="W1", made_by_name="Abigail"))
    sync(client, jbin(made_by="W2", made_by_name="Boykie", changed_by_name="Boykie"))
    [b] = bins(client)
    assert (b["empty_kg"], b["full_kg"], b["made_by_name"], b["changed_by_name"]) == (37, 503, "Abigail", "Boykie")


def test_number_is_unique_until_the_bin_is_removed(client):
    sync(client, jbin())
    assert "already used" in sync(client, jbin("b2"))["rejected"][0]["error"]
    sync(client, jbin(removed=True))
    assert sync(client, jbin("b2"))["synced"] == ["b2"]


@pytest.mark.parametrize("bad", [
    {"bin_no": 0}, {"empty_kg": None, "full_kg": None}, {"full_kg": 30}, {"empty_kg": -1},
])
def test_bad_bins_are_rejected_not_stored(client, bad):
    assert sync(client, jbin(**bad))["rejected"][0]["uuid"] == "b1"
    assert bins(client) == []


def juice_note(*uuids, **kw):
    return note(pallets=(), bins=[{"uuid": u} for u in uuids], receiver="Onderberg", **kw)


def test_full_bins_go_on_one_j_note_and_print(client):
    sync(client, jbin(), jbin("b2", 89, empty_kg=33, full_kg=529), jbin("b3", 90, full_kg=None))
    assert "needs its empty and full" in sync_notes(client, juice_note("b3"))["rejected"][0]["error"]
    assert sync_notes(client, juice_note("b2", "b1"))["synced"] == ["n1"]
    [n] = notes(client)
    assert [(b["bin_no"], b["full_kg"] - b["empty_kg"]) for b in n["bins"]] == [(88, 466), (89, 496)]
    assert n["target_receiver"] == "" and n["pallets"] == []
    assert "already on note J-1335" in sync_notes(client, juice_note("b1", uuid="n2", note_no=1336))["rejected"][0]["error"]
    r = client.get("/api/deliverynote/n1/pdf")
    assert r.status_code == 200 and 'J-1335' in r.headers["content-disposition"]


def test_a_note_holds_pallets_or_bins_not_both(client):
    from tests.test_consignment import cons, pallet
    from tests.test_consignment import sync as sync_pallets
    sync_pallets(client, [cons()], [pallet("p1")])
    sync(client, jbin())
    assert "not both" in sync_notes(client, note(bins=[{"uuid": "b1"}]))["rejected"][0]["error"]


def test_juice_notes_count_on_their_own_from_j_0001(client):
    from tests.test_consignment import cons, pallet
    from tests.test_consignment import sync as sync_pallets
    sync_pallets(client, [cons()], [pallet("p1")])
    sync(client, jbin(), jbin("b2", 89))
    sync_notes(client, note(note_no=1))  # B-1 on the pallets' series
    assert sync_notes(client, juice_note("b1", note_no=1, uuid="j1"))["synced"] == ["j1"]
    assert "J-0001 is already used" in sync_notes(client, juice_note("b2", note_no=1, uuid="j2"))["rejected"][0]["error"]
    opts = client.get("/api/deliverynote/options").json()
    assert (opts["last_no"], opts["last_juice_no"]) == (1, 1)
    r = client.get("/api/deliverynote/j1/pdf")
    assert 'J-0001' in r.headers["content-disposition"]


def test_crates_are_numbered_apart_and_go_on_the_note_after_the_bins(client):
    crate = jbin("c1", 88, container="crate", empty_kg=2, full_kg=21.5)
    assert sync(client, jbin(), crate)["synced"] == ["b1", "c1"]  # bin 88 and crate 88
    assert "crate 88 is already used" in sync(client, jbin("c2", 88, container="crate"))["rejected"][0]["error"]
    assert "a bin or a crate" in sync(client, jbin("x", 1, container="box"))["rejected"][0]["error"]
    assert "weight per crate" in sync(client, jbin("c3", 89, container="crate", full_kg=None))["rejected"][0]["error"]
    sync_notes(client, juice_note("c1", "b1"))
    assert [(b["container"], b["bin_no"]) for b in notes(client)[0]["bins"]] == [("bin", 88), ("crate", 88)]
    assert client.get("/api/deliverynote/n1/pdf").status_code == 200


def test_a_crate_record_is_a_batch_counted_not_weighed(client):
    batch = jbin("c1", 1, container="crate", count=12, empty_kg=None, full_kg=20)
    assert "weight per crate" in sync(client, {**batch, "full_kg": None})["rejected"][0]["error"]
    assert "a bin is one bin" in sync(client, jbin("b9", 9, count=3))["rejected"][0]["error"]
    sync(client, batch, jbin())
    sync_notes(client, juice_note("c1", "b1"))
    assert notes(client)[0]["bins"][1]["count"] == 12
    from routers.delivery_note import _bin_net, _containers
    assert [_bin_net(b) for b in notes(client)[0]["bins"]] == [466, 240]  # 12 x 20 kg
    assert _containers(notes(client)[0]["bins"]) == "1 bin · 12 crates"
    assert client.get("/api/deliverynote/n1/pdf").status_code == 200
