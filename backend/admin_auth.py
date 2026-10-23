"""The 4-digit settings PIN - what keeps the floor tablets out of Settings.

Adapted from Boord Labour's admin_auth.py. Tailscale cannot do this on its
own: every packhouse tablet is on the tailnet, so "came over Tailscale" is
true for all of them. Settings endpoints therefore depend on require_admin,
which wants a cookie that only a correct PIN hands out.

The PIN is set on the server console (set_pin.py), never through the web
page - otherwise whoever opened Settings first on a fresh install would get
to choose it.

Unlike Labour's admin phone, these tablets are shared on the floor, so the
cookie is a session cookie and the page signs out as soon as Settings is
left. It also carries a fingerprint of the PIN hash, so changing the PIN
signs every tablet out.
"""
import hashlib
import hmac
import os
import secrets
import threading
import time
from typing import Optional

from fastapi import HTTPException, Request

import config

PIN_FILE = os.path.join(config.DATA_DIR, "admin_pin.txt")
SECRET_FILE = os.path.join(config.DATA_DIR, ".secret_key")
COOKIE = "packhouse_admin"
PIN_LENGTH = 4
_ITERATIONS = 200_000

# One global failure counter, not one per tablet: counting per tablet would
# only give someone guessing more tries. Four digits is 10,000 PINs; at five
# tries per five minutes, trying them all takes about a week of nonstop
# guessing. Changing the PIN (set_pin.py) is the answer to a suspected leak.
MAX_FAILURES = 5
LOCKOUT_SECONDS = 300
_failures = 0
_locked_until = 0.0
_lock = threading.Lock()


def _hash(pin: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, _ITERATIONS).hex()


def _stored() -> Optional[tuple]:
    """(salt bytes, hash hex), or None when no PIN has been set."""
    try:
        with open(PIN_FILE, encoding="utf-8") as fh:
            salt_hex, digest = fh.read().strip().split(":")
        return bytes.fromhex(salt_hex), digest
    except (OSError, ValueError):
        return None


def pin_is_set() -> bool:
    return _stored() is not None


def set_pin(pin: str) -> None:
    pin = pin.strip()
    if len(pin) != PIN_LENGTH or not pin.isdigit():
        raise ValueError(f"The PIN must be exactly {PIN_LENGTH} digits")
    salt = secrets.token_bytes(16)
    with open(PIN_FILE, "w", encoding="utf-8") as fh:
        fh.write(f"{salt.hex()}:{_hash(pin, salt)}")


def check_pin(pin: str) -> bool:
    stored = _stored()
    return stored is not None and hmac.compare_digest(_hash(pin.strip(), stored[0]), stored[1])


def _secret() -> bytes:
    if not os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "w", encoding="utf-8") as fh:
            fh.write(secrets.token_hex(32))
    with open(SECRET_FILE, encoding="utf-8") as fh:
        return fh.read().strip().encode()


def _sign(fingerprint: str) -> str:
    return hmac.new(_secret(), fingerprint.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    fingerprint = _stored()[1][:16]
    return f"{fingerprint}.{_sign(fingerprint)}"


def token_valid(token: Optional[str]) -> bool:
    stored = _stored()
    if not token or stored is None or "." not in token:
        return False
    fingerprint, sig = token.split(".", 1)
    return (hmac.compare_digest(fingerprint, stored[1][:16])
            and hmac.compare_digest(sig, _sign(fingerprint)))


def attempt_login(pin: str) -> None:
    """Raises HTTPException unless `pin` is right; counts failures."""
    global _failures, _locked_until
    if not pin_is_set():
        raise HTTPException(409, "Set the settings PIN on the server first (backend\\set_pin.py)")
    with _lock:
        if time.monotonic() < _locked_until:
            raise HTTPException(429, "Too many wrong PINs - wait 5 minutes and try again")
        if check_pin(pin):
            _failures = 0
            return
        _failures += 1
        if _failures >= MAX_FAILURES:
            _failures = 0
            _locked_until = time.monotonic() + LOCKOUT_SECONDS
    raise HTTPException(401, "Wrong PIN")


def require_admin(request: Request) -> None:
    if not token_valid(request.cookies.get(COOKIE)):
        raise HTTPException(401, "Settings PIN needed")
