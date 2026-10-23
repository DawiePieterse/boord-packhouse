"""The header weather is Boord's answer passed through, and Boord being
unreachable is an empty answer, never an error."""
import io
import json

import routers.weather as weather


def test_passes_boords_answer_through(client, monkeypatch):
    seen = {}

    def fake_urlopen(url, timeout):
        seen["url"] = url
        return io.BytesIO(json.dumps({"temp": 24.3, "humidity": 61, "condition": "Clear"}).encode())

    monkeypatch.setattr(weather.urllib.request, "urlopen", fake_urlopen)
    assert client.get("/api/weather/current").json() == {"temp": 24.3, "humidity": 61, "condition": "Clear"}
    assert seen["url"].endswith("/api/weather/current")


def test_boord_down_is_empty_not_an_error(client, monkeypatch):
    def refused(url, timeout):
        raise OSError("connection refused")

    monkeypatch.setattr(weather.urllib.request, "urlopen", refused)
    r = client.get("/api/weather/current")
    assert r.status_code == 200 and r.json() == {}
