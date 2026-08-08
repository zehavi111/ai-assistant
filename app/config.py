"""App configuration from environment variables, with safe local-dev defaults."""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/app.db")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "changeme")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-not-for-production")

# App version = short SHA of the deployed commit (Render injects RENDER_GIT_COMMIT
# on every deploy, so this bumps automatically per commit). "dev" locally.
APP_VERSION = os.environ.get("RENDER_GIT_COMMIT", "")[:7] or "dev"

# Session cookie lifetime: 60 days.
SESSION_MAX_AGE = 60 * 24 * 3600
