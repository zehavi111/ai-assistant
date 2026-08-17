"""Routine history: read the append-only journal. Cold path — never on Today."""
import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import RoutineLog
from app.schemas import RoutineLogOut

router = APIRouter(
    prefix="/api/routines", tags=["history"], dependencies=[Depends(require_auth)]
)

COLUMNS = ["recorded_at", "task_id", "title", "kind", "action", "occurrence_date", "reason"]


def _query(
    task_id: int | None,
    action: str | None,
    since: date | None,
    until: date | None,
    limit: int,
):
    q = select(RoutineLog)
    if task_id is not None:
        q = q.where(RoutineLog.task_id == task_id)
    if action:
        q = q.where(RoutineLog.action.in_(action.split(",")))
    if since:
        q = q.where(RoutineLog.occurrence_date >= since)
    if until:
        q = q.where(RoutineLog.occurrence_date <= until)
    return q.order_by(RoutineLog.recorded_at.desc(), RoutineLog.id.desc()).limit(limit)


@router.get("/history", response_model=list[RoutineLogOut])
def list_history(
    task_id: int | None = None,
    action: str | None = None,  # CSV: complete,skip,uncomplete,unskip,delete
    since: date | None = None,
    until: date | None = None,
    limit: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    return list(db.scalars(_query(task_id, action, since, until, limit)))


@router.get("/history.csv")
def history_csv(
    task_id: int | None = None,
    action: str | None = None,
    since: date | None = None,
    until: date | None = None,
    limit: int = Query(5000, ge=1, le=50000),
    db: Session = Depends(get_db),
):
    """Whole journal as CSV — open it in a spreadsheet and analyze."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    for r in db.scalars(_query(task_id, action, since, until, limit)):
        w.writerow(
            [
                r.recorded_at.isoformat(timespec="seconds") if r.recorded_at else "",
                r.task_id,
                r.title,
                r.kind,
                r.action,
                r.occurrence_date.isoformat() if r.occurrence_date else "",
                r.reason or "",
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="routine-history.csv"'},
    )
