"""The farm's live weather for the header, passed through from Boord.

Boord owns the weather source (an iWeathar station or GPS, set in Boord's
Settings) and caches it, so this asks Boord rather than scraping again. The
answer is Boord's as-is: {temp, humidity, condition}, {"no_location": true}
when Boord has no source set, or {} when the weather can't be had. Weather
is a nice-to-have, so Boord being down is {} here, never an error.
"""
import json
import urllib.request

from fastapi import APIRouter

import config

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/current")
def current_weather():
    try:
        with urllib.request.urlopen(f"{config.BOORD_URL}/api/weather/current", timeout=5) as resp:
            return json.loads(resp.read())
    except Exception:  # noqa: BLE001 - see the module docstring
        return {}
