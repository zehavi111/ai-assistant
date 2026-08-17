"""Grocery list: items grouped by Section(kind='grocery'), checkable one by one or per section."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import KV, GroceryItem, Section
from app.schemas import (
    GroceryCheckBody,
    GroceryItemCreate,
    GroceryItemOut,
    GroceryItemUpdate,
)

router = APIRouter(
    prefix="/api/grocery", tags=["grocery"], dependencies=[Depends(require_auth)]
)


def _import_legacy_note(db: Session) -> None:
    """One-off: the old free-text grocery note becomes one item per line."""
    row = db.get(KV, "grocery_note")
    if not row or not row.value.strip():
        return
    for i, line in enumerate(l.strip() for l in row.value.splitlines()):
        if line:
            db.add(GroceryItem(name=line[:200], sort_order=i))
    row.value = ""  # text is preserved as items; keep the row so we never re-import
    db.commit()


def _out(items: list[GroceryItem], names: dict[int, str]) -> list[GroceryItemOut]:
    out = []
    for it in items:
        o = GroceryItemOut.model_validate(it)
        o.section_name = names.get(it.section_id) if it.section_id else None
        out.append(o)
    return out


def _one(db: Session, it: GroceryItem) -> GroceryItemOut:
    s = db.get(Section, it.section_id) if it.section_id else None
    return _out([it], {s.id: s.name} if s else {})[0]


@router.get("/items", response_model=list[GroceryItemOut])
def list_items(db: Session = Depends(get_db)):
    items = list(
        db.scalars(select(GroceryItem).order_by(GroceryItem.sort_order, GroceryItem.id))
    )
    if not items:
        _import_legacy_note(db)
        items = list(
            db.scalars(
                select(GroceryItem).order_by(GroceryItem.sort_order, GroceryItem.id)
            )
        )
    names = {
        s.id: s.name
        for s in db.scalars(select(Section).where(Section.kind == "grocery"))
    }
    return _out(items, names)


@router.post("/items", response_model=GroceryItemOut)
def create_item(body: GroceryItemCreate, db: Session = Depends(get_db)):
    it = GroceryItem(**body.model_dump())
    db.add(it)
    db.commit()
    return _one(db, it)


@router.patch("/items/{item_id}", response_model=GroceryItemOut)
def update_item(item_id: int, body: GroceryItemUpdate, db: Session = Depends(get_db)):
    it = db.get(GroceryItem, item_id)
    if not it:
        raise HTTPException(404, "Item not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(it, k, v)
    if "checked" in data:
        it.checked_at = datetime.utcnow() if data["checked"] else None
    db.commit()
    return _one(db, it)


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    it = db.get(GroceryItem, item_id)
    if not it:
        raise HTTPException(404, "Item not found")
    db.delete(it)
    db.commit()
    return {"ok": True}


@router.post("/check")
def check_bulk(body: GroceryCheckBody, db: Session = Depends(get_db)):
    """Tick a whole section (or the whole list) in one round trip."""
    q = GroceryItem.__table__.update()
    if not body.all:
        q = q.where(
            GroceryItem.section_id == body.section_id
            if body.section_id is not None
            else GroceryItem.section_id.is_(None)
        )
    res = db.execute(
        q.values(
            checked=body.checked,
            checked_at=datetime.utcnow() if body.checked else None,
        )
    )
    db.commit()
    return {"ok": True, "updated": res.rowcount}


@router.post("/clear-checked")
def clear_checked(db: Session = Depends(get_db)):
    """Shopping done — drop everything already in the basket."""
    res = db.execute(GroceryItem.__table__.delete().where(GroceryItem.checked.is_(True)))
    db.commit()
    return {"ok": True, "deleted": res.rowcount}
