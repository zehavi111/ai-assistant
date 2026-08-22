# Life OS — Personal Life-Management PWA

## Rules (IMMUTABLE — never modify this section)

1. **Never commit.** Do not run `git commit`, `git push`, or any write-git operation unless the user explicitly asks for it in their prompt. No direct commits when responding to prompts.
2. **Keep docs current.** On every prompt that changes the project, update `CLAUDE.md`, `requirements.txt`, and `README.md` to reflect the change — EXCEPT this Rules section of `CLAUDE.md`, which must never be modified, reworded, or removed.

## Project Overview

A single-user, mobile-first PWA for managing all aspects of a busy life:

- **Tasks** — short tasks (due date + optional `"HH:MM"` time), long projects (with subtasks + progress + deadlines; editable from the project header's **Edit**), daily missions (with streaks), recurring routines. The Tasks screen has 4 segments: Tasks | Projects | Routines | Calls.
- **Routines** — repeat every N days / weeks / months, or weekly on picked weekdays (with an N-week interval), plus a start/next date and an optional time of day (`due_time`). Every occurrence — daily or recurring, today's or a missed one — can be completed or **declined** (skipped) from its row.
- **Calls** — calls to make: `kind='call'` rows on the tasks table with a `phone` column; `tel:` + WhatsApp (`wa.me`) links, Contact Picker API on Chrome Android (manual name/phone fallback everywhere).
- **Sections** — user-defined lists (Work, Finance, …), **separate per module**: `Section.kind` ∈ `task|project|routine|call|grocery` (daily+recurring share `routine`). Managed from a sheet on the Tasks/Grocery header, scoped to the active segment (`openSectionsSheetFor(kind, label, onChange)` in `tasks.js`). Done items everywhere collapse under a tappable "Done (N) ▸" disclosure.
- **Schedule** — day/week calendar of events; tasks/projects/calls with due dates and routine occurrences appear on the calendar.
- **Meals** — weekly B/L/D planner, meal library, and a doorway to the grocery list (unbought count).
- **Grocery** — its own screen in the More menu: items grouped by grocery sections, each item checkable (= bought) at any time, a **Check all / Uncheck all** per section, and **Clear bought** to sweep the basket off the list.
- **Study** — queue of topics to study/deep-dive (queued / in progress / done).
- **Today dashboard** — the home screen: overdue, today's schedule, daily missions, due tasks + pending routine occurrences, calls due, meals — in one glance.
- **People** — removed from the app: no nav entry, no route, no view file. `app/routers/people.py`, the `Person` model, and the `people` table are deliberately left intact so nothing is lost — restoring the screen means re-adding `static/js/views/people.js` plus its route in `app.js`/`sw.js`.

Installed on the phone via browser "Add to Home Screen" (no app store).

## Architecture

- **Backend:** FastAPI + SQLAlchemy 2.x + Pydantic v2. All models in `app/models.py`, all schemas in `app/schemas.py`, one router per module in `app/routers/`. Tables created via `create_all` on startup (no Alembic); `run_light_migrations` in `app/db.py` then patches missing columns onto existing tables with plain `ALTER TABLE ADD COLUMN` (idempotent, works on SQLite + Postgres) — add new columns there.
- **DB:** SQLite locally (`data/app.db`, auto-created), Postgres (Neon) in production — switched by `DATABASE_URL`. `app/db.py` normalizes `postgres://` → `postgresql+psycopg://` and sets `pool_pre_ping` for Neon.
- **Auth:** single password (`APP_PASSWORD` env) → signed httpOnly cookie (`itsdangerous`), 60-day expiry. `require_auth` dependency on every data router; login/health/static open.
- **Frontend:** vanilla JS SPA in `static/` — NO build step, NO npm. Hash router in `js/app.js`; one ES module per screen in `js/views/`; shared helpers in `js/ui.js` (DOM builder `el()`, bottom sheets, toasts, date utils) and `js/api.js` (fetch wrapper, 401 → login). Design tokens in `css/tokens.css` (light + dark).
- **Recurrence/streaks:** pure functions in `app/recurrence.py` (`recur_unit`: `day`/`interval`, `week`, `month` — monthly clamps to month end, so anchor day can drift on late completion). `week` + `recur_weekdays` + `recur_interval` N = the picked weekdays, every Nth week: after the last picked weekday of a week it jumps to that week's Monday + 7·N days, so the anchor week never drifts. Template + `next_due` model — no instance rows; `next_due` = earliest *unresolved* occurrence (resolved = `task_completions` ∪ `task_skips`) and doubles as the user-settable start date (`TaskCreate.next_due`). Pending occurrences are enumerated on the fly (`pending_occurrences`, cap 7) into `TaskOut.pending_dates`; each can be completed or declined (`POST /api/tasks/{id}/skip|unskip?date=&reason=`) individually. Streaks cached on the task row, recomputed on complete/uncomplete (daily kind only).
- **Routine history:** `routine_log` is an append-only journal (`_log()` in `routers/tasks.py`) of every complete/skip/uncomplete/unskip/delete, with the title + kind snapshotted and **no FK** — it deliberately outlives the routine, so `delete_task` never cascades it away. Completions/skips remain the current *state*; the log is the history. Read it via `GET /api/routines/history` (filters: `task_id`, `action`, `since`, `until`, `limit`) or `GET /api/routines/history.csv` for spreadsheet analysis (`app/routers/history.py`). Cold path only — never touched by Today.
- **Grocery:** `grocery_items` (name, qty, `section_id` → `Section(kind='grocery')`, `checked` + `checked_at`) in `app/routers/grocery.py`. Bulk `POST /api/grocery/check` ticks one section (`section_id: null` = the unsectioned group) or `{"all": true}` the whole list in one round trip; `POST /api/grocery/clear-checked` deletes what's been bought. The old free-text grocery note (`kv['grocery_note']`) is imported once, line-by-line, on the first `GET /api/grocery/items` that finds no items.
- **Dates:** the client always sends its local date as `?date=YYYY-MM-DD`. Never use server-side "today" for user-facing date logic (server is UTC on Render).

## Conventions

- Bump the `CACHE` version string in `static/sw.js` on ANY static-file change, or the phone will serve stale assets.
- New static JS/CSS files must also be added to the `SHELL` list in `sw.js`.
- API is CRUD-simple JSON under `/api`; add new endpoints to the matching module router with `dependencies=[Depends(require_auth)]`.
- **Never serialize a list of tasks with per-row queries.** `task_out(db, t, for_date, ctx)` takes a `ctx` from `build_ctx(db, rows, for_date)`, which prefetches completions, skips, sections, and subtask counts in a fixed number of queries. Without it a realistic Today payload cost 51 round trips instead of 12 — seconds of latency against a remote DB. Any new endpoint returning many tasks must build a ctx.
- Times are `"HH:MM"` strings; dates are ISO date columns (not datetimes) wherever possible. Routines reuse `due_time` for their time of day (they have no `due_date`).
- Anything a routine action should leave behind for later analysis goes through `_log()` — never write `routine_log` from a view or ad-hoc query, and never delete from it.
- Priority scale everywhere: 0 none, 1 low, 2 medium, 3 high. Weekdays: Monday=0 CSV (e.g. `"0,2,4"`).
- WhatsApp links are `https://wa.me/<digits>` — correct only when the stored phone is in international format (country code, no leading 00/+ needed after stripping). There is no web API for WhatsApp contact lists.
- Keep it personal-tool simple: no over-abstraction, few files, no heavy test ceremony.
- **Guard every render against its own re-entry.** `render()` in `tasks.js`/`calendar.js`/`today.js` awaits data before appending, so a second render started mid-flight (tapping a segment on a slow link) would append into the same node and draw the screen twice. Each render takes a sequence number and returns after every `await` if a newer one has started — keep that pattern in any new view.
- **Never block the UI on a round trip.** The host is a free tier in Oregon and the user is on mobile in Israel, so every call costs ~0.5s warm. Completing/skipping paints the row optimistically and POSTs in the background (`toggleComplete(t, onChange, rowEl)`, `occurrenceRow`'s `resolve`), reverting only on failure — never re-render the whole view for a checkbox. Screen chrome (header, segmented control) renders before any `await`. Sections are memoized per kind in `tasks.js` (`sectionsFor`/`invalidateSections`) — call `invalidateSections()` after any section write.
- `api.js` aborts requests after 90s and shows the `#wake-banner` ("Waking up the server…") once anything is in flight >2.5s, so a cold start never looks like a frozen app.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload    # http://localhost:8000, password default "changeme"
```

Smoke test: `GET /api/health` → `{"status":"ok","db":"ok"}`.

## Deploy

Render free tier via `render.yaml` + free Neon Postgres. Env vars: `DATABASE_URL`, `APP_PASSWORD`, `SECRET_KEY`. See README for steps.

Live service: `srv-d9svgmm417fc73bgjrfg` (`life-os-eu`, **Frankfurt**) → https://life-os-eu.onrender.com, backed by the Neon project `snowy-resonance-05022097` in `aws-eu-central-1`. App and database are deliberately in the same region: when they were split across Oregon and Ohio a single query cost ~111ms, and co-located it is ~4ms. Keep them together — never point this service at a database in another region.

If a deploy does not start automatically on push, trigger it manually (Render dashboard → Manual Deploy, or the Render MCP `trigger_deploy`).

To move the database between regions, use `scripts/migrate_db.py` (`SOURCE_URL=… TARGET_URL=… python scripts/migrate_db.py`) — it copies every table, rewires the self-referencing `tasks.parent_id`, resets Postgres sequences, verifies row counts, and refuses a non-empty target.

Free tier sleeps after ~15 min idle; the next request then waits ~30-60s for a cold start (confirmed in logs: shutdown exactly 15 min after the last request, ~20s to boot). `.github/workflows/keep-warm.yml` pings the live service's `/api/health` every 5 min from 05:00-21:59 UTC to prevent that, using ~520 of the 750 free instance-hours/month. Adding another free Render service would risk blowing that budget.

Version: `GET /api/version` returns the contents of the tracked `VERSION` file (e.g. `0.0.10`), shown at the bottom of the More sheet (fetched fresh on each open, never cached by the SW). **Bump `VERSION` in every commit that changes the app** — it is the only way to tell which build is live. Do not try to derive it from git history: Render builds from a shallow clone, so `git rev-list --count HEAD` is always 1. Note: for a few minutes after a service is first created, Render's edge intermittently returns 404 with `x-render-routing: no-server` while routing propagates — the app is fine, it settles on its own.
