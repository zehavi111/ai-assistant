"""Tasks: plain tasks, projects (+subtasks), dailies, recurring. Complete/uncomplete."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import RoutineLog, Section, Task, TaskCompletion, TaskSkip
from app.recurrence import (
    advance_due_date,
    compute_streak,
    next_unresolved,
    parse_weekdays,
    pending_occurrences,
)
from app.schemas import TaskCreate, TaskOut, TaskUpdate

router = APIRouter(
    prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_auth)]
)


def _resolved_dates(db: Session, task_id: int, since: date | None = None) -> set[date]:
    """Completion + skip dates for a task (optionally only >= since)."""
    cq = select(TaskCompletion.date).where(TaskCompletion.task_id == task_id)
    sq = select(TaskSkip.date).where(TaskSkip.task_id == task_id)
    if since:
        cq = cq.where(TaskCompletion.date >= since)
        sq = sq.where(TaskSkip.date >= since)
    return set(db.scalars(cq)) | set(db.scalars(sq))


def _log(db: Session, t: Task, action: str, occurrence: date | None, reason: str | None = None) -> None:
    """Journal a routine action. Append-only — never updated, never cascaded away."""
    if t.kind not in ("daily", "recurring"):
        return
    db.add(
        RoutineLog(
            task_id=t.id, title=t.title, kind=t.kind, action=action,
            occurrence_date=occurrence, reason=reason,
        )
    )


def build_ctx(db: Session, tasks: list[Task], for_date: date | None = None) -> dict:
    """Prefetch everything task_out needs for a whole list in a handful of queries.

    Without this each task costs 1-4 extra round trips; against a remote DB that
    is the difference between a snappy screen and a multi-second one.
    """
    ctx: dict = {"done": set(), "resolved": {}, "sections": {}, "subtasks": {}}
    if not tasks:
        return ctx

    repeat_ids = [t.id for t in tasks if t.kind in ("daily", "recurring")]
    recurring_ids = [t.id for t in tasks if t.kind == "recurring"]
    project_ids = [t.id for t in tasks if t.kind == "project"]
    section_ids = {t.section_id for t in tasks if t.section_id}

    if for_date and repeat_ids:
        ctx["done"] = set(
            db.scalars(
                select(TaskCompletion.task_id).where(
                    TaskCompletion.task_id.in_(repeat_ids),
                    TaskCompletion.date == for_date,
                )
            )
        )

    if for_date and recurring_ids:
        resolved: dict[int, set[date]] = {i: set() for i in recurring_ids}
        for tid, d in db.execute(
            select(TaskCompletion.task_id, TaskCompletion.date).where(
                TaskCompletion.task_id.in_(recurring_ids)
            )
        ):
            resolved[tid].add(d)
        for tid, d in db.execute(
            select(TaskSkip.task_id, TaskSkip.date).where(
                TaskSkip.task_id.in_(recurring_ids)
            )
        ):
            resolved[tid].add(d)
        ctx["resolved"] = resolved

    if section_ids:
        ctx["sections"] = {
            s.id: s.name
            for s in db.scalars(select(Section).where(Section.id.in_(section_ids)))
        }

    if project_ids:
        rows = db.execute(
            select(
                Task.parent_id,
                func.count(),
                func.sum(case((Task.status == "done", 1), else_=0)),
            )
            .where(Task.parent_id.in_(project_ids))
            .group_by(Task.parent_id)
        )
        ctx["subtasks"] = {pid: (total, done or 0) for pid, total, done in rows}

    return ctx


def task_out(
    db: Session, t: Task, for_date: date | None = None, ctx: dict | None = None
) -> TaskOut:
    """Serialize one task. Pass ctx from build_ctx() when rendering a list."""
    out = TaskOut.model_validate(t)

    if t.kind in ("daily", "recurring") and for_date:
        if ctx is not None:
            out.done_today = t.id in ctx["done"]
        else:
            out.done_today = db.scalar(
                select(TaskCompletion.id).where(
                    TaskCompletion.task_id == t.id, TaskCompletion.date == for_date
                )
            ) is not None

    if t.kind == "recurring" and for_date and t.next_due:
        resolved = (
            ctx["resolved"].get(t.id, set())
            if ctx is not None
            else _resolved_dates(db, t.id, since=t.next_due)
        )
        out.pending_dates = [
            d.isoformat()
            for d in pending_occurrences(
                t.recur_unit, t.recur_interval, t.recur_weekdays,
                t.next_due, for_date, resolved,
            )
        ]

    if t.section_id:
        if ctx is not None:
            out.section_name = ctx["sections"].get(t.section_id)
        else:
            s = db.get(Section, t.section_id)
            out.section_name = s.name if s else None

    if t.kind == "project":
        if ctx is not None:
            out.subtask_total, out.subtask_done = ctx["subtasks"].get(t.id, (0, 0))
        else:
            out.subtask_total = (
                db.scalar(select(func.count()).where(Task.parent_id == t.id)) or 0
            )
            out.subtask_done = (
                db.scalar(
                    select(func.count()).where(
                        Task.parent_id == t.id, Task.status == "done"
                    )
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
    """next_due = earliest unresolved occurrence (resolved = completed or skipped).

    Resolving a middle pending date leaves older pending dates in place;
    un-resolving a date re-pends it; double-resolving the same day is stable.
    """
    resolved = _resolved_dates(db, t.id)
    candidates = [d for d in (t.next_due, undone_date) if d]
    if candidates:
        start = min(candidates)
    elif resolved:
        # Legacy: next_due was never set — restart after the latest resolved date.
        start = advance_due_date(
            t.recur_unit, t.recur_interval, t.recur_weekdays, max(resolved)
        )
    else:
        return
    t.next_due = next_unresolved(
        t.recur_unit, t.recur_interval, t.recur_weekdays, start, resolved
    )


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
    rows = list(db.scalars(q))
    ctx = build_ctx(db, rows, date_param)
    return [task_out(db, t, date_param, ctx) for t in rows]


@router.post("", response_model=TaskOut)
def create_task(
    body: TaskCreate,
    date_param: date | None = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date_param or date.today()  # client's local date when provided
    t = Task(**body.model_dump())
    if t.kind in ("daily", "recurring"):
        t.recur_unit = t.recur_unit or "day"
        t.recur_interval = t.recur_interval or 1
        # First occurrence: the chosen start date (default today), unless a
        # weekly rule pushes it onto the next picked weekday.
        start = body.next_due or today
        weekdays = parse_weekdays(t.recur_weekdays)
        if t.recur_unit == "week" and weekdays and start.weekday() not in weekdays:
            start = advance_due_date(
                t.recur_unit, t.recur_interval, t.recur_weekdays, start
            )
        t.next_due = start
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
    # Rule edited without an explicit start date: pull next_due onto the new rule.
    rule_changed = {"recur_unit", "recur_interval", "recur_weekdays"} & data.keys()
    if rule_changed and "next_due" not in data and t.kind in ("daily", "recurring") and t.next_due:
        weekdays = parse_weekdays(t.recur_weekdays)
        if t.recur_unit == "week" and weekdays and t.next_due.weekday() not in weekdays:
            t.next_due = advance_due_date(
                t.recur_unit, t.recur_interval, t.recur_weekdays, t.next_due
            )
    db.commit()
    return task_out(db, t)


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    # routine_log is deliberately NOT cascaded — the history outlives the routine.
    _log(db, t, "delete", None)
    # Manual cascade for subtasks + completions + skips (SQLite FKs off by default).
    for sub in db.scalars(select(Task).where(Task.parent_id == task_id)):
        db.execute(
            TaskCompletion.__table__.delete().where(TaskCompletion.task_id == sub.id)
        )
        db.execute(TaskSkip.__table__.delete().where(TaskSkip.task_id == sub.id))
        db.delete(sub)
    db.execute(
        TaskCompletion.__table__.delete().where(TaskCompletion.task_id == task_id)
    )
    db.execute(TaskSkip.__table__.delete().where(TaskSkip.task_id == task_id))
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
            _log(db, t, "complete", date_param)
        _resync_next_due(db, t)
        _recompute_streak(db, t, date_param)
    else:
        t.status = "done"
        t.completed_at = datetime.utcnow()
    db.commit()
    return task_out(db, t, date_param)


@router.post("/{task_id}/skip", response_model=TaskOut)
def skip_task(
    task_id: int,
    date_param: date = Query(..., alias="date"),
    reason: str | None = Query(None, max_length=200),
    db: Session = Depends(get_db),
):
    """Decline an occurrence: resolve it without completing. Streaks untouched."""
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if t.kind not in ("daily", "recurring"):
        raise HTTPException(400, "Only daily/recurring tasks can be skipped")
    row = db.scalar(
        select(TaskSkip).where(
            TaskSkip.task_id == t.id, TaskSkip.date == date_param
        )
    )
    if row:
        if reason:
            row.reason = reason
    else:
        db.add(TaskSkip(task_id=t.id, date=date_param, reason=reason))
        db.flush()  # session has autoflush off — make the row visible to queries
        _log(db, t, "skip", date_param, reason)
    _resync_next_due(db, t)
    db.commit()
    return task_out(db, t, date_param)


@router.post("/{task_id}/unskip", response_model=TaskOut)
def unskip_task(
    task_id: int,
    date_param: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    db.execute(
        TaskSkip.__table__.delete().where(
            TaskSkip.task_id == t.id, TaskSkip.date == date_param
        )
    )
    _log(db, t, "unskip", date_param)
    _resync_next_due(db, t, undone_date=date_param)
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
        _log(db, t, "uncomplete", date_param)
        _resync_next_due(db, t, undone_date=date_param)
        _recompute_streak(db, t, date_param)
    else:
        t.status = "open"
        t.completed_at = None
    db.commit()
    return task_out(db, t, date_param)
