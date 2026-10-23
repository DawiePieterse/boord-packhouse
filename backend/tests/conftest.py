"""Test fixtures. Environment is set BEFORE config/db/main are imported,
because they read it at import time."""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="boordpackhouse-tests-")
os.environ["PACKHOUSE_DATA_DIR"] = _TMP
os.environ["PACKHOUSE_DB_PATH"] = os.path.join(_TMP, "packhouse.db")

import pytest  # noqa: E402


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    import admin_auth
    import main

    # https, because the settings cookie is Secure and httpx will not send a
    # Secure cookie back over plain http.
    with TestClient(main.app, base_url="https://testserver") as c:
        if os.path.exists(admin_auth.PIN_FILE):
            os.remove(admin_auth.PIN_FILE)
        admin_auth._failures, admin_auth._locked_until = 0, 0.0
        yield c


ADMIN_PIN = "4321"


@pytest.fixture
def admin_client(client):
    import admin_auth
    admin_auth.set_pin(ADMIN_PIN)
    assert client.post("/api/admin/login", json={"pin": ADMIN_PIN}).status_code == 200
    return client
