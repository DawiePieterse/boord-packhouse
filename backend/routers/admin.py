from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import SQLModel

import admin_auth
from admin_auth import COOKIE, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginIn(SQLModel):
    pin: str


class PinChange(SQLModel):
    current: str
    new: str


def _set_cookie(response: Response) -> None:
    # No max_age: a session cookie, because the tablets are shared. The page
    # also logs out whenever Settings is left (frontend/app.js).
    response.set_cookie(COOKIE, admin_auth.make_token(),
                        httponly=True, secure=True, samesite="strict")


@router.post("/login")
def login(body: LoginIn, response: Response):
    admin_auth.attempt_login(body.pin)
    _set_cookie(response)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, httponly=True, secure=True, samesite="strict")
    return {"ok": True}


@router.get("/me", dependencies=[Depends(require_admin)])
def me():
    return {"admin": True}


@router.post("/pin", dependencies=[Depends(require_admin)])
def change_pin(body: PinChange, response: Response):
    """Signs every other tablet out (their cookies carry the old PIN's
    fingerprint) and re-issues this tablet's cookie so it stays in."""
    # 400, not 401. This tablet IS signed in - require_admin has just said so -
    # and app.js answers a 401 by showing the PIN pad, so a typo in the
    # "Current PIN" box would sign it out mid-change (a lesson from Labour).
    if not admin_auth.check_pin(body.current):
        raise HTTPException(400, "The current PIN is wrong")
    try:
        admin_auth.set_pin(body.new)
    except ValueError as e:
        raise HTTPException(422, str(e))
    _set_cookie(response)
    return {"ok": True}
