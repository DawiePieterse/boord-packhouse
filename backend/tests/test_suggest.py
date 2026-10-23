"""The suggested time is worked out on the tablet (frontend/suggest.js, so it
works offline); its checks live in frontend/suggest_check.js and run here."""
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend")


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_suggest_js_checks_pass():
    out = subprocess.run(["node", os.path.join(FRONTEND, "suggest_check.js")], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


def test_settings_are_open_to_tablets_but_changed_behind_the_pin(client):
    s = client.get("/api/sulfur/settings").json()
    assert s["ref_grams"] == 425 and s["ref_crate_kg"] == 20 and "McLean's Red" in s["variety_factors"]
    assert (s["residue_ref_ppm"], s["residue_calibrated"], s["residue_limit_ppm"]) == (5, False, 10)
    assert client.get("/api/settings/sulfur").status_code == 401
    assert client.put("/api/settings/sulfur", json={}).status_code == 401


SETTINGS = {"ref_grams": 425, "ref_crates": 24, "ref_crate_kg": 20, "ref_temp": 25, "ref_humidity": 60,
            "temp_pct_per_deg": 2, "humidity_pct_per_pct": 0.5, "min_minutes": 30, "max_minutes": 120,
            "round_to": 5, "variety_factors": {"Mauritius": 1.0, "McLean's Red": 0.85, " ": 1.0},
            "residue_ref_ppm": 5, "residue_calibrated": False, "residue_limit_ppm": 10, "residue_warn_ppm": 8}


def test_save_sulfur_settings(admin_client):
    got = admin_client.get("/api/settings/sulfur").json()
    assert got["varieties"] == ["Early Delight", "Third Month Red"]
    saved = admin_client.put("/api/settings/sulfur", json={**SETTINGS, "temp_pct_per_deg": 1.5,
                                                           "residue_ref_ppm": 3.2, "residue_calibrated": True}).json()
    assert saved["temp_pct_per_deg"] == 1.5
    assert saved["residue_ref_ppm"] == 3.2 and saved["residue_calibrated"] is True
    assert '"McLean\'s Red": 0.85' in saved["variety_factors"] and '" "' not in saved["variety_factors"]
    assert admin_client.get("/api/sulfur/settings").json()["temp_pct_per_deg"] == 1.5


@pytest.mark.parametrize("bad", [{"min_minutes": 90, "max_minutes": 60}, {"ref_grams": 0},
                                 {"variety_factors": {"Mauritius": 0}}, {"round_to": 0},
                                 {"residue_ref_ppm": 0}, {"residue_warn_ppm": 12}])
def test_bad_sulfur_settings_are_refused(admin_client, bad):
    assert admin_client.put("/api/settings/sulfur", json={**SETTINGS, **bad}).status_code == 422


def test_runs_keep_what_went_into_the_suggestion(client):
    from tests.test_sulfur import run, sync
    sync(client, run(suggested_minutes=45, minutes=50, fruit_kg=480, suggestion_temp=31, suggestion_humidity=40,
                     estimated_ppm=5.6))
    r = client.get("/api/sulfur/runs").json()["runs"][0]
    assert (r["suggested_minutes"], r["minutes"], r["fruit_kg"], r["suggestion_temp"], r["estimated_ppm"]) == (45, 50, 480, 31, 5.6)
