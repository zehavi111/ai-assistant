"""User-defined sections (Work, Finance, ...) shared by all task kinds."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import Section, Task
from app.schemas import SectionCreate, SectionOut, SectionUpdate

router = APIRouter(
    prefix="/api/sections", tags=["sections"], dependencies=[Depends(require_auth)]
)


@router.get("", response_model=list[SectionOut])
def list_sections(db: Session = Depends(get_db)):
    return list(db.scalars(select(Section).order_by(Section.sort_order, Section.name)))


@router.post("", response_model=SectionOut)
def create_section(body: SectionCreate, db: Session = Depends(get_db)):
    s = Section(**body.model_dump())
    db.add(s)
    db.commit()
    return s


@router.patch("/{section_id}", response_model=SectionOut)
def update_section(section_id: int, body: SectionUpdate, db: Session = Depends(get_db)):
    s = db.get(Section, section_id)
    if not s:
        raise HTTPException(404, "Section not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    return s


@router.delete("/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db)):
    s = db.get(Section, section_id)
    if not s:
        raise HTTPException(404, "Section not found")
    # Manual un-link (SQLite FKs off by default) — tasks keep their data.
    db.execute(
        Task.__table__.update()
        .where(Task.section_id == section_id)
        .values(section_id=None)
    )
    db.delete(s)
    db.commit()
    return {"ok": True}
