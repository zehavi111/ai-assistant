"""Calendar events CRUD + range query."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Event
from app.schemas import EventCreate, EventOut, EventUpdate

router = APIRouter(
    prefix="/api/events", tags=["events"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[EventOut])
def list_events(start: date, end: date, db: Session = Depends(get_db)):
    q = (
        select(Event)
        .where(Event.date >= start, Event.date <= end)
        .order_by(Event.date, Event.all_day.desc(), Event.start_time)
    )
    return list(db.scalars(q))


@router.post("", response_model=EventOut)
def create_event(body: EventCreate, db: Session = Depends(get_db)):
    e = Event(**body.model_dump())
    db.add(e)
    db.commit()
    return e


@router.patch("/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: EventUpdate, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    return e


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    db.delete(e)
    db.commit()
    return {"ok": True}
