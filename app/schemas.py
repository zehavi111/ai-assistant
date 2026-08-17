"""All Pydantic v2 schemas."""
import datetime as dt

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- Tasks ----
class TaskCreate(BaseModel):
    title: str
    notes: str | None = None
    kind: str = "task"  # task | project | daily | recurring | call
    parent_id: int | None = None
    priority: int = 0
    due_date: dt.date | None = None
    due_time: str | None = None  # "HH:MM"
    section_id: int | None = None
    phone: str | None = None
    recur_unit: str | None = None
    recur_interval: int | None = None
    recur_weekdays: str | None = None
    next_due: dt.date | None = None  # routines: first occurrence / anchor date
    sort_order: int = 0


class TaskUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    priority: int | None = None
    due_date: dt.date | None = None
    due_time: str | None = None
    section_id: int | None = None
    phone: str | None = None
    status: str | None = None
    recur_unit: str | None = None
    recur_interval: int | None = None
    recur_weekdays: str | None = None
    next_due: dt.date | None = None
    sort_order: int | None = None


class TaskOut(ORMModel):
    id: int
    title: str
    notes: str | None
    kind: str
    parent_id: int | None
    priority: int
    due_date: dt.date | None
    due_time: str | None
    section_id: int | None
    phone: str | None
    status: str
    completed_at: dt.datetime | None
    recur_unit: str | None
    recur_interval: int | None
    recur_weekdays: str | None
    next_due: dt.date | None
    streak_current: int
    streak_best: int
    sort_order: int
    # Extras filled by routers where relevant:
    done_today: bool = False
    subtask_total: int = 0
    subtask_done: int = 0
    section_name: str | None = None
    pending_dates: list[str] = []


class RoutineLogOut(ORMModel):
    id: int
    task_id: int
    title: str
    kind: str
    action: str
    occurrence_date: dt.date | None
    reason: str | None
    recorded_at: dt.datetime


# ---- Sections ----
class SectionCreate(BaseModel):
    name: str
    kind: str = "task"  # task | project | routine | call
    sort_order: int = 0


class SectionUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    sort_order: int | None = None


class SectionOut(ORMModel):
    id: int
    name: str
    kind: str
    sort_order: int


# ---- Events ----
class EventCreate(BaseModel):
    title: str
    notes: str | None = None
    location: str | None = None
    date: dt.date
    start_time: str | None = None
    end_time: str | None = None
    all_day: bool = False


class EventUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    location: str | None = None
    date: dt.date | None = None
    start_time: str | None = None
    end_time: str | None = None
    all_day: bool | None = None


class EventOut(ORMModel):
    id: int
    title: str
    notes: str | None
    location: str | None
    date: dt.date
    start_time: str | None
    end_time: str | None
    all_day: bool


# ---- People ----
class PersonCreate(BaseModel):
    name: str
    relation: str | None = None
    phone: str | None = None
    notes: str | None = None
    contact_method: str | None = None
    followup_date: dt.date | None = None
    followup_note: str | None = None


class PersonUpdate(BaseModel):
    name: str | None = None
    relation: str | None = None
    phone: str | None = None
    notes: str | None = None
    contact_method: str | None = None
    last_contacted: dt.date | None = None
    followup_date: dt.date | None = None
    followup_note: str | None = None


class PersonOut(ORMModel):
    id: int
    name: str
    relation: str | None
    phone: str | None
    notes: str | None
    contact_method: str | None
    last_contacted: dt.date | None
    followup_date: dt.date | None
    followup_note: str | None


class SnoozeBody(BaseModel):
    days: int


# ---- Meals ----
class MealCreate(BaseModel):
    name: str
    notes: str | None = None
    tags: str | None = None


class MealUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    tags: str | None = None


class MealOut(ORMModel):
    id: int
    name: str
    notes: str | None
    tags: str | None


class MealSlotSet(BaseModel):
    date: dt.date
    slot: str  # breakfast | lunch | dinner
    meal_id: int | None = None
    custom_text: str | None = None


class MealSlotOut(BaseModel):
    date: dt.date
    slot: str
    meal_id: int | None
    custom_text: str | None
    meal_name: str | None  # resolved library name


# ---- Grocery ----
class GroceryItemCreate(BaseModel):
    name: str
    section_id: int | None = None
    qty: str | None = None
    sort_order: int = 0


class GroceryItemUpdate(BaseModel):
    name: str | None = None
    section_id: int | None = None
    qty: str | None = None
    checked: bool | None = None
    sort_order: int | None = None


class GroceryItemOut(ORMModel):
    id: int
    name: str
    section_id: int | None
    qty: str | None
    checked: bool
    sort_order: int
    section_name: str | None = None


class GroceryCheckBody(BaseModel):
    """Bulk check/uncheck. section_id None = the unsectioned group; all=every item."""

    checked: bool
    section_id: int | None = None
    all: bool = False


# ---- Study ----
class StudyCreate(BaseModel):
    title: str
    notes: str | None = None
    status: str = "queued"
    priority: int = 0
    sort_order: int = 0


class StudyUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    status: str | None = None
    priority: int | None = None
    sort_order: int | None = None


class StudyOut(ORMModel):
    id: int
    title: str
    notes: str | None
    status: str
    priority: int
    sort_order: int
