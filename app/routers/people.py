"""People & follow-ups."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Person
from app.schemas import PersonCreate, PersonOut, PersonUpdate, SnoozeBody

router = APIRouter(
    prefix="/api/people", tags=["people"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[PersonOut])
def list_people(
    due: bool = False,
    date_param: date | None = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    q = select(Person)
    if due:
        d = date_param or date.today()
        q = q.where(Person.followup_date.is_not(None), Person.followup_date <= d)
        q = q.order_by(Person.followup_date)
    else:
        q = q.order_by(Person.name)
    return list(db.scalars(q))


@router.post("", response_model=PersonOut)
def create_person(body: PersonCreate, db: Session = Depends(get_db)):
    p = Person(**body.model_dump())
    db.add(p)
    db.commit()
    return p


@router.patch("/{person_id}", response_model=PersonOut)
def update_person(person_id: int, body: PersonUpdate, db: Session = Depends(get_db)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return p


@router.delete("/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/{person_id}/contacted", response_model=PersonOut)
def mark_contacted(
    person_id: int,
    date_param: date = Query(..., alias="date"),
    db: Session = Depends(get_db),
):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    p.last_contacted = date_param
    p.followup_date = None
    p.followup_note = None
    db.commit()
    return p


@router.post("/{person_id}/snooze", response_model=PersonOut)
def snooze(person_id: int, body: SnoozeBody, db: Session = Depends(get_db)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Person not found")
    base = max(date.today(), p.followup_date or date.today())
    p.followup_date = base + timedelta(days=body.days)
    db.commit()
    return p
