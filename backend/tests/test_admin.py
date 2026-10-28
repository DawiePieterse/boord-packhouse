"""The floor tablets must not reach Settings: every settings endpoint wants
the cookie only the right 4-digit PIN hands out."""
import pytest

import admin_auth
from tests.conftest import ADMIN_PIN


def test_settings_closed_without_the_pin(client):
    assert client.get("/api/admin/me").status_code == 401
    assert client.post("/api/admin/pin", json={"current": "1", "new": "2"}).status_code == 401


def test_login_refused_until_pin_set_on_server(client):
    assert client.post("/api/admin/login", json={"pin": "0000"}).status_code == 409


@pytest.mark.parametrize("bad", ["123", "12345", "12a4", ""])
def test_pin_must_be_four_digits(bad):
    with pytest.raises(ValueError):
        admin_auth.set_pin(bad)


def test_wrong_pin_then_lockout(client):
    admin_auth.set_pin(ADMIN_PIN)
    for _ in range(admin_auth.MAX_FAILURES):
        assert client.post("/api/admin/login", json={"pin": "0000"}).status_code == 401
    # Locked: even the right PIN is refused for now.
    assert client.post("/api/admin/login", json={"pin": ADMIN_PIN}).status_code == 429


def test_cookie_is_a_session_cookie(client):
    admin_auth.set_pin(ADMIN_PIN)
    r = client.post("/api/admin/login", json={"pin": ADMIN_PIN})
    cookie = r.headers["set-cookie"].lower()
    assert "max-age" not in cookie and "expires" not in cookie
    assert "secure" in cookie and "httponly" in cookie


def test_right_pin_unlocks_and_logout_locks(admin_client):
    assert admin_client.get("/api/admin/me").status_code == 200
    admin_client.post("/api/admin/logout")
    assert admin_client.get("/api/admin/me").status_code == 401


def test_changing_the_pin_signs_other_tablets_out(admin_client):
    other = admin_client.cookies.get(admin_auth.COOKIE)
    r = admin_client.post("/api/admin/pin", json={"current": ADMIN_PIN, "new": "9876"})
    assert r.status_code == 200
    assert admin_client.get("/api/admin/me").status_code == 200  # this tablet re-issued
    assert not admin_auth.token_valid(other)
    assert admin_client.post("/api/admin/pin", json={"current": "0000", "new": "1111"}).status_code == 400


def test_check_takes_the_pin_without_opening_settings(client):
    admin_auth.set_pin(ADMIN_PIN)
    assert client.post("/api/admin/check", json={"pin": "0000"}).status_code == 401
    r = client.post("/api/admin/check", json={"pin": ADMIN_PIN})
    assert r.status_code == 200 and "set-cookie" not in r.headers
    assert client.get("/api/admin/me").status_code == 401
