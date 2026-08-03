"""Study/deep-dive topic queue."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import StudyTopic
from app.schemas import StudyCreate, StudyOut, StudyUpdate

router = APIRouter(
    prefix="/api/study", tags=["study"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[StudyOut])
def list_topics(status: str | None = None, db: Session = Depends(get_db)):
    q = select(StudyTopic)
    if status:
        q = q.where(StudyTopic.status == status)
    q = q.order_by(StudyTopic.sort_order, StudyTopic.priority.desc(), StudyTopic.id)
    return list(db.scalars(q))


@router.post("", response_model=StudyOut)
def create_topic(body: StudyCreate, db: Session = Depends(get_db)):
    t = StudyTopic(**body.model_dump())
    db.add(t)
    db.commit()
    return t


@router.patch("/{topic_id}", response_model=StudyOut)
def update_topic(topic_id: int, body: StudyUpdate, db: Session = Depends(get_db)):
    t = db.get(StudyTopic, topic_id)
    if not t:
        raise HTTPException(404, "Topic not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    if data.get("status") == "done":
        t.completed_at = datetime.utcnow()
    elif "status" in data:
        t.completed_at = None
    db.commit()
    return t


@router.delete("/{topic_id}")
def delete_topic(topic_id: int, db: Session = Depends(get_db)):
    t = db.get(StudyTopic, topic_id)
    if not t:
        raise HTTPException(404, "Topic not found")
    db.delete(t)
    db.commit()
    return {"ok": True}
