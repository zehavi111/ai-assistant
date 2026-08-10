"""Copy every row from one Life OS database to another.

Used to move the database between regions (co-locating it with the web
service removes ~200ms from every query). Safe to re-run: the target is
created from the models and must be empty.

    SOURCE_URL='postgres://…old…' TARGET_URL='postgres://…new…' \
        python scripts/migrate_db.py

Both URLs accept the same schemes as DATABASE_URL (postgres://,
postgresql://, sqlite:///…). Nothing is written to the source.
"""
import os
import sys

from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import Base  # noqa: E402
from app.models import (  # noqa: E402
    KV, Event, Meal, MealPlan, Person, Section, StudyTopic, Task,
    TaskCompletion, TaskSkip,
)

# Parents before children: sections and meals are referenced by tasks/meal_plan.
ORDER = [Section, Meal, Task, TaskCompletion, TaskSkip, Event, Person,
         MealPlan, StudyTopic, KV]


def normalize(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> int:
    src_url, dst_url = os.environ.get("SOURCE_URL"), os.environ.get("TARGET_URL")
    if not src_url or not dst_url:
        print("Set SOURCE_URL and TARGET_URL", file=sys.stderr)
        return 2

    src = create_engine(normalize(src_url))
    dst = create_engine(normalize(dst_url))

    Base.metadata.create_all(bind=dst)

    with Session(src) as s, Session(dst) as d:
        # Refuse to merge into a database that already holds data.
        for model in ORDER:
            if d.scalar(select(func.count()).select_from(model)):
                print(f"Target already has {model.__tablename__} rows — aborting.",
                      file=sys.stderr)
                return 1

        for model in ORDER:
            rows = list(s.scalars(select(model)))
            cols = [c.name for c in inspect(model).mapper.columns]
            if model is Task:
                # Self-referencing FK: insert flat, then wire parents up.
                links = {}
                for r in rows:
                    data = {c: getattr(r, c) for c in cols}
                    if data.get("parent_id") is not None:
                        links[data["id"]] = data.pop("parent_id")
                        data["parent_id"] = None
                    d.add(model(**data))
                d.flush()
                for child_id, parent_id in links.items():
                    d.execute(
                        Task.__table__.update()
                        .where(Task.id == child_id)
                        .values(parent_id=parent_id)
                    )
            else:
                for r in rows:
                    d.add(model(**{c: getattr(r, c) for c in cols}))
                d.flush()
            print(f"  {model.__tablename__:18s} {len(rows):5d} rows")

        d.commit()

        # Explicit ids were inserted, so bump the identity sequences past them.
        if dst.dialect.name == "postgresql":
            for model in ORDER:
                pk = list(inspect(model).mapper.primary_key)[0]
                if pk.type.python_type is not int:
                    continue
                d.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{model.__tablename__}', "
                    f"'{pk.name}'), COALESCE((SELECT MAX({pk.name}) "
                    f"FROM {model.__tablename__}), 1))"
                ))
            d.commit()
            print("  sequences reset")

    # Verify: row counts must match on both sides.
    ok = True
    with Session(src) as s, Session(dst) as d:
        for model in ORDER:
            a = s.scalar(select(func.count()).select_from(model))
            b = d.scalar(select(func.count()).select_from(model))
            if a != b:
                print(f"MISMATCH {model.__tablename__}: source {a}, target {b}",
                      file=sys.stderr)
                ok = False
    print("Row counts match." if ok else "Verification FAILED.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
