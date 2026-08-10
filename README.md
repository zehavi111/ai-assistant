# Life OS

Your whole life, one app. A personal, mobile-first PWA that manages:

- ✅ **Tasks** — quick tasks (due date **and time**), long projects with subtasks + deadlines, daily missions with 🔥 streaks, routines (daily / weekly / monthly / every-N-days) where each missed occurrence can be completed or skipped individually
- 📞 **Calls** — calls you need to make: pick from phone contacts (Chrome Android) or type a name, one-tap `tel:` / WhatsApp, priority + due date/time
- 🗂 **Sections** — your own labels (Work, Finance, …), a separate list per module (tasks / projects / routines / calls); done items tuck away under a collapsible "Done" group
- 📅 **Schedule** — day & week calendar; tasks, project deadlines, routines, and calls all appear alongside events
- 👋 **People** — follow-up reminders, one-tap `tel:`/`sms:`, snooze (in the More menu)
- 🍽️ **Meals** — weekly breakfast/lunch/dinner planner, meal library, grocery notes
- 📚 **Study** — queue of topics to learn or deep-dive
- ☀️ **Today** — one dashboard with everything that matters right now: overdue, schedule, missions, due tasks, routine occurrences, calls, meals

No app store: open it in your phone's browser and **Add to Home Screen** — it installs and behaves like a native app.

**Live:** https://life-os-li19.onrender.com (Render free tier + Neon Postgres)

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

> **Note:** Render's free tier sleeps after ~15 min idle, and the next visit waits ~30-60s for it to boot. `.github/workflows/keep-warm.yml` pings the app every 5 minutes between 05:00-21:59 UTC to keep it awake during waking hours (staying inside the 750 free instance-hours/month). Outside that window the first open is slow — the app shows a "Waking up the server…" banner rather than a blank screen.

Every push to `main` auto-deploys. The running version (`0.0.N`, where N = commit count — bumps on every commit) is shown at the bottom of the **More** menu in the app — if it went up after a push, the deploy landed.

## Install on your phone

- **iPhone (Safari):** open the app URL → Share → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu ⋮ → **Add to Home screen** / **Install app**. Chrome may also show an "Install" banner automatically — the app meets all installability criteria (manifest + maskable icon + service worker).

Log in once — the session lasts 60 days.

## Tech

FastAPI · SQLAlchemy 2 · Pydantic v2 · SQLite/Postgres · vanilla-JS PWA (no build step) · single-password auth (signed httpOnly cookie).

Project conventions and architecture: see [CLAUDE.md](CLAUDE.md).
