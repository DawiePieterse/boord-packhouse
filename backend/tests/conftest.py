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

    import main
    with TestClient(main.app) as c:
        yield c
