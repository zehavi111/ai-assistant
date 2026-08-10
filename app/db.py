"""SQLAlchemy engine/session setup. SQLite locally, Postgres (Neon) in production."""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL

url = DATABASE_URL
# Render/Neon hand out the legacy scheme; SQLAlchemy needs the psycopg3 driver name.
if url.startswith("postgres://"):
    url = url.replace("postgres://", "postgresql+psycopg://", 1)
elif url.startswith("postgresql://"):
    url = url.replace("postgresql://", "postgresql+psycopg://", 1)

if url.startswith("sqlite"):
    os.makedirs("data", exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False})
else:
    # pool_pre_ping handles Neon auto-suspend wakeups.
    engine = create_engine(url, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def run_light_migrations(engine) -> None:
    """create_all never adds columns to existing tables; patch them in. Idempotent."""
    from sqlalchemy import inspect, text

    wanted = {
        "tasks": {
            "due_time": "VARCHAR(5)",
            "section_id": "INTEGER",
            "phone": "VARCHAR(50)",
        },
        "sections": {"kind": "VARCHAR(10) DEFAULT 'task'"},
    }
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in wanted.items():
            existing = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
