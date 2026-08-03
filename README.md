# Life OS

Your whole life, one app. A personal, mobile-first PWA that manages:

- ✅ **Tasks** — quick tasks, long projects with subtasks, daily missions with 🔥 streaks, recurring tasks
- 📅 **Schedule** — day & week calendar; due tasks show up on the calendar too
- 👋 **People** — who to call/text, follow-up reminders, one-tap `tel:`/`sms:`, snooze
- 🍽️ **Meals** — weekly breakfast/lunch/dinner planner, meal library, grocery notes
- 📚 **Study** — queue of topics to learn or deep-dive
- ☀️ **Today** — one dashboard with everything that matters right now

No app store: open it in your phone's browser and **Add to Home Screen** — it installs and behaves like a native app.

## Local run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000 — default password is `changeme` (override with `APP_PASSWORD`).
Data is stored in `data/app.db` (SQLite, auto-created).

## Deploy (free): Render + Neon

Free hosts wipe local disk on restart, so production data lives in a free cloud Postgres:

1. **Neon** — create a free project at https://neon.tech, copy the connection string (starts with `postgres://…`, includes `sslmode=require`).
2. **GitHub** — push this repo.
3. **Render** — https://render.com → New → **Blueprint** → pick the repo (it reads `render.yaml`).
4. When prompted, set:
   - `DATABASE_URL` — the Neon connection string
   - `APP_PASSWORD` — your login password
   - (`SECRET_KEY` is auto-generated)
5. Deploy, then open the app URL.

> **Note:** Render's free tier sleeps after idle — first open after a while takes ~30s to wake. Not a bug.

## Install on your phone

- **iPhone (Safari):** open the app URL → Share → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu ⋮ → **Add to Home screen** / **Install app**. Chrome may also show an "Install" banner automatically — the app meets all installability criteria (manifest + maskable icon + service worker).

Log in once — the session lasts 60 days.

## Tech

FastAPI · SQLAlchemy 2 · Pydantic v2 · SQLite/Postgres · vanilla-JS PWA (no build step) · single-password auth (signed httpOnly cookie).

Project conventions and architecture: see [CLAUDE.md](CLAUDE.md).
