"""Tasks: plain tasks, projects (+subtasks), dailies, recurring. Complete/uncomplete."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Task, TaskCompletion
from app.recurrence import advance_due_date, compute_streak
from app.schemas import TaskCreate, TaskOut, TaskUpdate

router = APIRouter(
    prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_auth)]
)


def task_out(db: Session, t: Task, for_date: date | None = None) -> TaskOut:
    out = TaskOut.model_validate(t)
    if t.kind in ("daily", "recurring") and for_date:
        done = db.scalar(
            select(TaskCompletion.id).where(
                TaskCompletion.task_id == t.id, TaskCompletion.date == for_date
            )
        )
        out.done_today = done is not None
    if t.kind == "project":
        out.subtask_total = (
            db.scalar(select(func.count()).where(Task.parent_id == t.id)) or 0
        )
        out.subtask_done = (
            db.scalar(
                select(func.count()).where(Task.parent_id == t.id, Task.status == "done")
            )
            or 0
        )
    return out


def _recompute_streak(db: Session, t: Task, today: date) -> None:
    if t.kind != "daily":
        return
    dates = set(
        db.scalars(select(TaskCompletion.date).where(TaskCompletion.task_id == t.id))
    )
    t.streak_current, t.streak_best = compute_streak(dates, today)


def _resync_next_due(db: Session, t: Task, undone_date: date | None = None) -> None:
    """next_due = next occurrence after the latest completion.

    Backfilling a past date never skips a still-pending occurrence, and
    completing the same day twice never double-advances.
    """
    latest = db.scalar(
        select(func.max(TaskCompletion.date)).where(TaskCompletion.task_id == t.id)
    )
    candidates = []
    if latest:
        candidates.append(
            advance_due_date(t.recur_unit, t.recur_interval, t.recur_weekdays, latest)
        )
    if undone_date:
        candidates.append(undone_date)  # the undone occurrence is pending again
    if candidates:
        t.next_due = min(candidates)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    kind: str | None = None,
    status: str | None = None,
    parent_id: int | None = None,
    top_level: bool = False,
    date_param: date | None = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    q = select(Task)
    if kind:
        q = q.where(Task.kind.in_(kind.split(",")))
    if status:
        q = q.where(Task.status == status)
    if parent_id is not None:
        q = q.where(Task.parent_id == parent_id)
    elif top_level:
        q = q.where(Task.parent_id.is_(None))
    q = q.order_by(Task.sort_order, Task.id)
    return [task_out(db, t, date_param) for t in db.scalars(q)]


@router.post("", response_model=TaskOut)
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    t = Task(**body.model_dump())
    if t.kind == "daily":
        t.recur_unit = t.recur_unit or "day"
        t.recur_interval = t.recur_interval or 1
        t.next_due = date.today()
    elif t.kind == "recurring":
        t.recur_unit = t.recur_unit or "day"
        t.recur_interval = t.recur_interval or 1
        # First occurrence: today unless a weekly rule pushes it forward.
        if t.recur_unit == "week":
            from app.recurrence import parse_weekdays

            if date.today().weekday() in parse_weekdays(t.recur_weekdays):
                t.next_due = date.today()
            else:
                t.next_due = advance_due_date(
                    t.recur_unit, t.recur_interval, t.recur_weekdays, date.today()
                )
        else:
            t.next_due = date.today()
    db.add(t)
    db.commit()
    return task_out(db, t)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    if "status" in data and t.kind in ("task", "project"):
        t.completed_at = datetime.utcnow() if data["status"] == "done" else None
    db.commit()
    return task_out(db, t)


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    # Manual cascade for subtasks + completions (SQLite FKs off by default).
    for sub in db.scalars(select(Task).where(Task.parent_id == task_id)):
        db.execute(
            TaskCompletion.__table__.delete().where(TaskCompletion.task_id == sub.id)
        )
        db.delete(sub)
    db.execute(
        TaskCompletion.__table__.delete().where(TaskCompletion.task_id == task_id)
    )
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/{task_id}/complete", response_model=TaskOut)
def complete_task(
    task_id: int,
    date_param: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if t.kind in ("daily", "recurring"):
        exists = db.scalar(
            select(TaskCompletion.id).where(
                TaskCompletion.task_id == t.id, TaskCompletion.date == date_param
            )
        )
        if not exists:
            db.add(TaskCompletion(task_id=t.id, date=date_param))
            db.flush()  # session has autoflush off — make the row visible to queries
        _resync_next_due(db, t)
        _recompute_streak(db, t, date_param)
    else:
        t.status = "done"
        t.completed_at = datetime.utcnow()
    db.commit()
    return task_out(db, t, date_param)


@router.post("/{task_id}/uncomplete", response_model=TaskOut)
def uncomplete_task(
    task_id: int,
    date_param: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if t.kind in ("daily", "recurring"):
        db.execute(
            TaskCompletion.__table__.delete().where(
                TaskCompletion.task_id == t.id, TaskCompletion.date == date_param
            )
        )
        _resync_next_due(db, t, undone_date=date_param)
        _recompute_streak(db, t, date_param)
    else:
        t.status = "open"
        t.completed_at = None
    db.commit()
    return task_out(db, t, date_param)
