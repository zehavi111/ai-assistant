"""Meal library, weekly plan, grocery note."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.db import get_db
from app.models import KV, Meal, MealPlan
from app.schemas import (
    GroceryBody,
    MealCreate,
    MealOut,
    MealSlotOut,
    MealSlotSet,
    MealUpdate,
)

router = APIRouter(prefix="/api", tags=["meals"], dependencies=[Depends(require_auth)])


@router.get("/meals", response_model=list[MealOut])
def list_meals(db: Session = Depends(get_db)):
    return list(db.scalars(select(Meal).order_by(Meal.name)))


@router.post("/meals", response_model=MealOut)
def create_meal(body: MealCreate, db: Session = Depends(get_db)):
    m = Meal(**body.model_dump())
    db.add(m)
    db.commit()
    return m


@router.patch("/meals/{meal_id}", response_model=MealOut)
def update_meal(meal_id: int, body: MealUpdate, db: Session = Depends(get_db)):
    m = db.get(Meal, meal_id)
    if not m:
        raise HTTPException(404, "Meal not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    return m


@router.delete("/meals/{meal_id}")
def delete_meal(meal_id: int, db: Session = Depends(get_db)):
    m = db.get(Meal, meal_id)
    if not m:
        raise HTTPException(404, "Meal not found")
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.get("/meal-plan", response_model=list[MealSlotOut])
def get_meal_plan(start: date, db: Session = Depends(get_db)):
    end = start + timedelta(days=6)
    rows = db.scalars(
        select(MealPlan).where(MealPlan.date >= start, MealPlan.date <= end)
    )
    out = []
    for r in rows:
        meal_name = None
        if r.meal_id:
            meal = db.get(Meal, r.meal_id)
            meal_name = meal.name if meal else None
        out.append(
            MealSlotOut(
                date=r.date,
                slot=r.slot,
                meal_id=r.meal_id,
                custom_text=r.custom_text,
                meal_name=meal_name,
            )
        )
    return out


@router.put("/meal-plan", response_model=MealSlotOut | None)
def set_meal_slot(body: MealSlotSet, db: Session = Depends(get_db)):
    row = db.scalar(
        select(MealPlan).where(MealPlan.date == body.date, MealPlan.slot == body.slot)
    )
    if body.meal_id is None and not body.custom_text:
        # Clear slot.
        if row:
            db.delete(row)
            db.commit()
        return None
    if not row:
        row = MealPlan(date=body.date, slot=body.slot)
        db.add(row)
    row.meal_id = body.meal_id
    row.custom_text = body.custom_text
    db.commit()
    meal_name = None
    if row.meal_id:
        meal = db.get(Meal, row.meal_id)
        meal_name = meal.name if meal else None
    return MealSlotOut(
        date=row.date,
        slot=row.slot,
        meal_id=row.meal_id,
        custom_text=row.custom_text,
        meal_name=meal_name,
    )


@router.get("/grocery")
def get_grocery(db: Session = Depends(get_db)):
    row = db.get(KV, "grocery_note")
    return {"text": row.value if row else ""}


@router.put("/grocery")
def set_grocery(body: GroceryBody, db: Session = Depends(get_db)):
    row = db.get(KV, "grocery_note")
    if not row:
        row = KV(key="grocery_note", value=body.text)
        db.add(row)
    else:
        row.value = body.text
    db.commit()
    return {"text": row.value}
