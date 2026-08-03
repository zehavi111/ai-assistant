# Life OS — Personal Life-Management PWA

## Rules (IMMUTABLE — never modify this section)

1. **Never commit.** Do not run `git commit`, `git push`, or any write-git operation unless the user explicitly asks for it in their prompt. No direct commits when responding to prompts.
2. **Keep docs current.** On every prompt that changes the project, update `CLAUDE.md`, `requirements.txt`, and `README.md` to reflect the change — EXCEPT this Rules section of `CLAUDE.md`, which must never be modified, reworded, or removed.

## Project Overview

A single-user, mobile-first PWA for managing all aspects of a busy life:

- **Tasks** — short tasks, long projects (with subtasks + progress), daily missions (with streaks), recurring tasks (every-N-days or weekly-by-weekday).
- **Schedule** — day/week calendar of events; tasks with due dates appear on the calendar.
- **People** — follow-up reminders, calls/texts to send (`tel:`/`sms:` links), last-contacted tracking, snooze.
- **Meals** — weekly B/L/D planner, meal library, grocery notes.
- **Study** — queue of topics to study/deep-dive (queued / in progress / done).
- **Today dashboard** — the home screen: overdue, today's schedule, daily missions, due tasks, follow-ups, meals — in one glance.

Installed on the phone via browser "Add to Home Screen" (no app store).

## Architecture

- **Backend:** FastAPI + SQLAlchemy 2.x + Pydantic v2. All models in `app/models.py`, all schemas in `app/schemas.py`, one router per module in `app/routers/`. Tables created via `create_all` on startup (no Alembic).
- **DB:** SQLite locally (`data/app.db`, auto-created), Postgres (Neon) in production — switched by `DATABASE_URL`. `app/db.py` normalizes `postgres://` → `postgresql+psycopg://` and sets `pool_pre_ping` for Neon.
- **Auth:** single password (`APP_PASSWORD` env) → signed httpOnly cookie (`itsdangerous`), 60-day expiry. `require_auth` dependency on every data router; login/health/static open.
- **Frontend:** vanilla JS SPA in `static/` — NO build step, NO npm. Hash router in `js/app.js`; one ES module per screen in `js/views/`; shared helpers in `js/ui.js` (DOM builder `el()`, bottom sheets, toasts, date utils) and `js/api.js` (fetch wrapper, 401 → login). Design tokens in `css/tokens.css` (light + dark).
- **Recurrence/streaks:** pure functions in `app/recurrence.py`. Template + `next_due` model — no instance rows; missed occurrences collapse into one overdue. Streaks cached on the task row, recomputed on complete/uncomplete.
- **Dates:** the client always sends its local date as `?date=YYYY-MM-DD`. Never use server-side "today" for user-facing date logic (server is UTC on Render).

## Conventions

- Bump the `CACHE` version string in `static/sw.js` on ANY static-file change, or the phone will serve stale assets.
- New static JS/CSS files must also be added to the `SHELL` list in `sw.js`.
- API is CRUD-simple JSON under `/api`; add new endpoints to the matching module router with `dependencies=[Depends(require_auth)]`.
- Times are `"HH:MM"` strings; dates are ISO date columns (not datetimes) wherever possible.
- Priority scale everywhere: 0 none, 1 low, 2 medium, 3 high. Weekdays: Monday=0 CSV (e.g. `"0,2,4"`).
- Keep it personal-tool simple: no over-abstraction, few files, no heavy test ceremony.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload    # http://localhost:8000, password default "changeme"
```

Smoke test: `GET /api/health` → `{"status":"ok","db":"ok"}`.

## Deploy

Render free tier via `render.yaml` + free Neon Postgres. Env vars: `DATABASE_URL`, `APP_PASSWORD`, `SECRET_KEY`. See README for steps.
