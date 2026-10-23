"""Backups: only when packhouse.db changed (nightly), always on Backup Now,
the newest 14 kept, behind the settings PIN."""
import os
import sqlite3
import zipfile

import pytest

import backup
import config


@pytest.fixture
def backups_dir(tmp_path, monkeypatch):
    d = str(tmp_path / "backups")
    monkeypatch.setattr(backup, "BACKUPS_DIR", d)
    monkeypatch.setattr(backup, "LAST_HASH", os.path.join(d, "last_hash.txt"))
    monkeypatch.setattr(backup, "COPY_DEST_FILE", str(tmp_path / "backup_copy_to.txt"))
    return d


def _change_db(value):
    con = sqlite3.connect(config.PACKHOUSE_DB_PATH)
    con.execute("CREATE TABLE IF NOT EXISTS t (v TEXT)")
    con.execute("INSERT INTO t VALUES (?)", (value,))
    con.commit()
    con.close()


def test_nightly_skips_when_unchanged_and_backs_up_on_change(backups_dir):
    _change_db("a")
    first = backup.create_backup(skip_if_unchanged=True)
    assert first and first.startswith("packhouse_backup_")
    with zipfile.ZipFile(os.path.join(backups_dir, first)) as zf:
        assert zf.namelist() == ["packhouse.db"]
    assert backup.create_backup(skip_if_unchanged=True) is None
    _change_db("b")
    assert backup.create_backup(skip_if_unchanged=True) is not None


def test_backup_now_always_writes(backups_dir):
    backup.create_backup()
    # Unchanged data, but Backup Now ignores that.
    assert backup.create_backup() is not None


def test_a_cleared_folder_is_not_skipped(backups_dir):
    backup.create_backup()
    for name in backup._archives():
        os.remove(os.path.join(backups_dir, name))
    assert backup.create_backup(skip_if_unchanged=True) is not None


def test_keeps_the_newest_fourteen(backups_dir):
    os.makedirs(backups_dir)
    for day in range(1, 21):
        open(os.path.join(backups_dir, f"packhouse_backup_202601{day:02d}_020000.zip"), "w").close()
    open(os.path.join(backups_dir, "packhouse-before-20260101-000000.db"), "w").close()
    backup.create_backup()
    archives = backup._archives()
    assert len(archives) == backup.MAX_BACKUPS == 14
    assert "packhouse_backup_20260101_020000.zip" not in archives
    # The updater's pre-update copies are not this pruner's to delete.
    assert os.path.exists(os.path.join(backups_dir, "packhouse-before-20260101-000000.db"))


def test_copies_offsite_to_boords_folder(backups_dir, tmp_path):
    dest = tmp_path / "usb"
    dest.mkdir()
    (tmp_path / "backup_copy_to.txt").write_text(str(dest))
    name = backup.create_backup()
    assert (dest / name).exists()


def test_backups_need_the_pin(client):
    assert client.get("/api/backups").status_code == 401
    assert client.post("/api/backups").status_code == 401
    assert client.get("/api/backups/x.zip/download").status_code == 401


def test_list_create_download(admin_client, backups_dir):
    name = admin_client.post("/api/backups").json()["filename"]
    assert [b["filename"] for b in admin_client.get("/api/backups").json()] == [name]
    r = admin_client.get(f"/api/backups/{name}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert admin_client.get("/api/backups/..%2Fpackhouse.db/download").status_code == 404
