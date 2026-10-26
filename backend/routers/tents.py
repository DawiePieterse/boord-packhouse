"""Settings -> Tents (add, rename, change defaults, retire) and Settings ->
Sulfur (the suggested-time numbers). Behind the PIN.

No tent delete: a retired tent (active = false) leaves the sulfur screen but
past runs keep pointing at it.
"""
import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

import boord
from admin_auth import require_admin
from db import get_packhouse_session
from models import SulfurSettings, Tent

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])


class TentIn(SQLModel):
    name: str
    default_grams: float = 425.0
    default_minutes: int = 60
    default_crates: int = 24
    active: bool = True
    sort: Optional[int] = None


def _check(body: TentIn) -> None:
    if not body.name.strip():
        raise HTTPException(422, "A tent needs a name")
    if not (body.default_grams > 0 and 1 <= body.default_minutes <= 600 and body.default_crates >= 1):
        raise HTTPException(422, "Grams, minutes and crates must be positive")


@router.get("/tents")
def all_tents(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Tent).order_by(Tent.sort, Tent.id)).all()


@router.post("/tents")
def add_tent(body: TentIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    last = session.exec(select(Tent).order_by(Tent.sort.desc())).first()
    tent = Tent(**body.model_dump(exclude={"sort"}), sort=(last.sort + 1) if last else 0)
    tent.name = tent.name.strip()
    session.add(tent)
    session.commit()
    session.refresh(tent)
    return tent


@router.put("/tents/{tent_id}")
def update_tent(tent_id: int, body: TentIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    tent = session.get(Tent, tent_id)
    if tent is None:
        raise HTTPException(404, "No such tent")
    for key, value in body.model_dump(exclude={"sort"}).items():
        setattr(tent, key, value)
    tent.name = tent.name.strip()
    if body.sort is not None:
        tent.sort = body.sort
    session.add(tent)
    session.commit()
    session.refresh(tent)
    return tent


class SulfurSettingsIn(SQLModel):
    ref_grams: float
    ref_crates: int
    ref_crate_kg: float
    ref_temp: float
    ref_humidity: float
    temp_pct_per_deg: float
    humidity_pct_per_pct: float
    min_minutes: int
    max_minutes: int
    round_to: int
    variety_factors: Dict[str, float] = {}
    residue_ref_ppm: float = 5.0
    residue_calibrated: bool = False
    residue_limit_ppm: float = 10.0
    residue_warn_ppm: float = 8.0
    sizes: Optional[List[str]] = None  # None: leave the list as it is


@router.get("/sulfur")
def sulfur_settings(session: Session = Depends(get_packhouse_session)):
    """The numbers, plus every variety on Boord's blocks so each can be
    given a factor."""
    return {"settings": session.get(SulfurSettings, 1), "varieties": boord.varieties()}


@router.put("/sulfur")
def save_sulfur_settings(body: SulfurSettingsIn, session: Session = Depends(get_packhouse_session)):
    if not (body.ref_grams > 0 and body.ref_crates >= 1 and body.ref_crate_kg > 0):
        raise HTTPException(422, "The reference grams, crates and crate weight must be positive")
    if not (1 <= body.min_minutes <= body.max_minutes <= 600 and body.round_to >= 1):
        raise HTTPException(422, "Minutes must run from a minimum up to a maximum, and round to at least 1")
    if not (body.residue_ref_ppm > 0 and 0 < body.residue_warn_ppm <= body.residue_limit_ppm):
        raise HTTPException(422, "The residue anchor must be above 0, and the warning at or below the limit")
    if any(not (0 < f <= 5) for f in body.variety_factors.values()):
        raise HTTPException(422, "A variety factor must be above 0 (1.0 means no change)")
    sizes = None
    if body.sizes is not None:
        sizes = list(dict.fromkeys(z.strip() for z in body.sizes if z.strip()))
        if not sizes:
            raise HTTPException(422, "Keep at least one fruit size")
    row = session.get(SulfurSettings, 1)
    for key, value in body.model_dump(exclude={"variety_factors", "sizes"}).items():
        setattr(row, key, value)
    if sizes is not None:
        row.sizes = json.dumps(sizes)
    row.variety_factors = json.dumps({k.strip(): v for k, v in body.variety_factors.items() if k.strip()})
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
