"""Aggregated Today dashboard payload — one request renders the whole home screen."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Event, MealPlan, Person, Task
from app.routers.tasks import task_out
from app.schemas import EventOut, PersonOut, TaskOut

router = APIRouter(prefix="/api", tags=["today"], dependencies=[Depends(require_auth)])


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

    # Plain tasks due today / overdue.
    due_tasks = list(
        db.scalars(
            select(Task).where(
                Task.kind == "task", Task.status == "open", Task.due_date == d
            )
        )
    )
    overdue_tasks = list(
        db.scalars(
            select(Task).where(
                Task.kind == "task", Task.status == "open", Task.due_date < d
            )
        )
    )

    # Recurring instances due (next_due <= d): overdue collapses into one.
    recurring_due = list(
        db.scalars(
            select(Task).where(Task.kind == "recurring", Task.next_due <= d)
        )
    )

    dailies = list(db.scalars(select(Task).where(Task.kind == "daily")))

    followups = list(
        db.scalars(
            select(Person)
            .where(Person.followup_date.is_not(None), Person.followup_date <= d)
            .order_by(Person.followup_date)
        )
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
            for t in due_tasks + recurring_due
        ],
        "overdue_tasks": [
            task_out(db, t, d).model_dump(mode="json") for t in overdue_tasks
        ],
        "dailies": [task_out(db, t, d).model_dump(mode="json") for t in dailies],
        "followups_due": [
            PersonOut.model_validate(p).model_dump(mode="json") for p in followups
        ],
        "meals": meals,
    }
