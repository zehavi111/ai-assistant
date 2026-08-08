"""Aggregated Today dashboard payload — one request renders the whole home screen."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Event, MealPlan, Task
from app.routers.tasks import task_out
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

    dailies = list(db.scalars(select(Task).where(Task.kind == "daily")))

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

    meal_rows = db.scalars(select(MealPlan).where(MealPlan.date == d))
    meals = {}
    for r in meal_rows:
        name = r.custom_text
        if r.meal_id:
            from app.models import Meal

            m = db.get(Meal, r.meal_id)
            name = m.name if m else r.custom_text
        meals[r.slot] = name

    return {
        "date": d.isoformat(),
        "events": [EventOut.model_validate(e).model_dump(mode="json") for e in events],
        "due_tasks": [
            task_out(db, t, d).model_dump(mode="json")
            for t in sorted(due_tasks, key=_time_key) + recurring_due
        ],
        "overdue_tasks": [
            task_out(db, t, d).model_dump(mode="json") for t in overdue_tasks
        ],
        "dailies": [task_out(db, t, d).model_dump(mode="json") for t in dailies],
        "calls_due": [task_out(db, t, d).model_dump(mode="json") for t in calls_due],
        "followups_due": [],  # stub: stale-SW shells may still read this key
        "meals": meals,
    }
