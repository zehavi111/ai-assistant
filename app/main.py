"""FastAPI app: routers, static files, SPA fallback."""
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app import auth, models  # noqa: F401 — models import registers tables
from app.db import Base, SessionLocal, engine, run_light_migrations
from app.routers import events, meals, people, sections, study, tasks, today

app = FastAPI(title="Life OS", docs_url=None, redoc_url=None)

Base.metadata.create_all(bind=engine)
run_light_migrations(engine)

app.include_router(auth.router)
app.include_router(today.router)
app.include_router(tasks.router)
app.include_router(events.router)
app.include_router(people.router)
app.include_router(meals.router)
app.include_router(study.router)
app.include_router(sections.router)


@app.get("/api/version")
def version():
    from app.config import APP_VERSION

    return {"version": APP_VERSION}


@app.get("/api/health")
def health():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"
    return {"status": "ok", "db": db_status}


# Static frontend. index.html served at root; SW must be served from root scope.
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/manifest.json")
def manifest():
    return FileResponse("static/manifest.json")


@app.get("/sw.js")
def service_worker():
    return FileResponse("static/sw.js", media_type="application/javascript")
