import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

import backup
from admin_auth import require_admin

# Every endpoint here is behind the settings PIN.
router = APIRouter(prefix="/api/backups", tags=["backups"], dependencies=[Depends(require_admin)])


@router.get("")
def get_backups():
    return backup.list_backups()


@router.post("")
def trigger_backup():
    return {"filename": backup.create_backup()}


@router.get("/{filename}/download")
def download_backup(filename: str):
    safe_name = os.path.basename(filename)
    path = os.path.join(backup.BACKUPS_DIR, safe_name)
    if not (safe_name.startswith(backup.PREFIX) and safe_name.endswith(".zip") and os.path.isfile(path)):
        raise HTTPException(404, "Backup not found")
    return FileResponse(path, media_type="application/zip", filename=safe_name)
