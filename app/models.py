"""All SQLAlchemy models. Dates are stored as Date columns; times as 'HH:MM' strings."""
import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 'task' | 'project' | 'daily' | 'recurring' | 'call'; subtasks are kind='task' with parent_id set
    kind: Mapped[str] = mapped_column(String(20), default="task")
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=0)  # 0 none, 1 low, 2 med, 3 high
    due_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    due_time: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM"
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("sections.id", ondelete="SET NULL"), nullable=True
    )
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)  # kind='call' only
    status: Mapped[str] = mapped_column(String(10), default="open")  # 'open' | 'done'
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # Recurrence: 'day' | 'week' | 'month' | 'interval'
    recur_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    recur_interval: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recur_weekdays: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "0,2,4" Mon=0
    next_due: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    streak_current: Mapped[int] = mapped_column(Integer, default=0)
    streak_best: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)


class TaskCompletion(Base):
    __tablename__ = "task_completions"
    __table_args__ = (UniqueConstraint("task_id", "date", name="uq_completion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    date: Mapped[dt.date] = mapped_column(Date)


class TaskSkip(Base):
    """A declined occurrence of a daily/recurring task — resolved without completing."""

    __tablename__ = "task_skips"
    __table_args__ = (UniqueConstraint("task_id", "date", name="uq_skip"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    date: Mapped[dt.date] = mapped_column(Date)


class Section(Base):
    """User-defined grouping label (Work, Finance, ...), separate list per module."""

    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # 'task' | 'project' | 'routine' | 'call' — which module this section belongs to
    kind: Mapped[str] = mapped_column(String(10), default="task")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    date: Mapped[dt.date] = mapped_column(Date)
    start_time: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM"
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    relation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_method: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 'call'|'text'
    last_contacted: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    followup_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    followup_note: Mapped[str | None] = mapped_column(String(300), nullable=True)


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str | None] = mapped_column(String(200), nullable=True)


class MealPlan(Base):
    __tablename__ = "meal_plan"
    __table_args__ = (UniqueConstraint("date", "slot", name="uq_meal_slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date)
    slot: Mapped[str] = mapped_column(String(10))  # 'breakfast' | 'lunch' | 'dinner'
    meal_id: Mapped[int | None] = mapped_column(
        ForeignKey("meals.id", ondelete="SET NULL"), nullable=True
    )
    custom_text: Mapped[str | None] = mapped_column(String(300), nullable=True)


class StudyTopic(Base):
    __tablename__ = "study_topics"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|in_progress|done
    priority: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class KV(Base):
    __tablename__ = "kv"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
