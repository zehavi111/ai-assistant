"""Aggregated Today dashboard payload — one request renders the whole home screen."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Event, Meal, MealPlan, Task
from app.routers.tasks import build_ctx, task_out
from app.schemas import EventOut

router = APIRouter(prefix="/api", tags=["today"], dependencies=[Depends(require_auth)])


def _time_key(t: Task):
    """Timed items first (by HH:MM), untimed after."""
    return (t.due_time is None, t.due_time or "")


@router.get("/today")
def get_today(date_param: date = Query(..., alias="date"), db: Session = Depends(get_db)):
    d = date_param

    events = list(
        db.scalars(
            select(Event)
            .where(Event.date == d)
            .order_by(Event.all_day.desc(), Event.start_time)
        )
    )

    # Tasks + projects due today / overdue.
    due_tasks = list(
        db.scalars(
            select(Task).where(
                Task.kind.in_(("task", "project")),
                Task.status == "open",
                Task.due_date == d,
            )
        )
    )
    overdue_tasks = list(
        db.scalars(
            select(Task).where(
                Task.kind.in_(("task", "project")),
                Task.status == "open",
                Task.due_date < d,
            )
        )
    )

    # Recurring with anything pending (next_due = earliest unresolved occurrence).
    recurring_due = list(
        db.scalars(
            select(Task).where(Task.kind == "recurring", Task.next_due <= d)
        )
    )

    # Routines carry an optional time of day — timed ones lead.
    dailies = sorted(db.scalars(select(Task).where(Task.kind == "daily")), key=_time_key)

    # Calls due today or earlier.
    calls_due = sorted(
        db.scalars(
            select(Task).where(
                Task.kind == "call", Task.status == "open",
                Task.due_date.is_not(None), Task.due_date <= d,
            )
        ),
        key=lambda t: (t.due_date, *_time_key(t)),
    )

    meal_rows = list(db.scalars(select(MealPlan).where(MealPlan.date == d)))
    meal_names = {}
    wanted = {r.meal_id for r in meal_rows if r.meal_id}
    if wanted:
        meal_names = {
            m.id: m.name for m in db.scalars(select(Meal).where(Meal.id.in_(wanted)))
        }
    meals = {
        r.slot: (meal_names.get(r.meal_id) or r.custom_text) for r in meal_rows
    }

    # One prefetch for every task the payload touches, instead of 1-4 queries each.
    ctx = build_ctx(
        db, due_tasks + recurring_due + overdue_tasks + dailies + calls_due, d
    )

    return {
        "date": d.isoformat(),
        "events": [EventOut.model_validate(e).model_dump(mode="json") for e in events],
        "due_tasks": [
            task_out(db, t, d, ctx).model_dump(mode="json")
            for t in sorted(due_tasks, key=_time_key) + sorted(recurring_due, key=_time_key)
        ],
        "overdue_tasks": [
            task_out(db, t, d, ctx).model_dump(mode="json") for t in overdue_tasks
        ],
        "dailies": [task_out(db, t, d, ctx).model_dump(mode="json") for t in dailies],
        "calls_due": [task_out(db, t, d, ctx).model_dump(mode="json") for t in calls_due],
        "followups_due": [],  # stub: stale-SW shells may still read this key
        "meals": meals,
    }
