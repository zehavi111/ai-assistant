"""App configuration from environment variables, with safe local-dev defaults."""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/app.db")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "changeme")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-not-for-production")

# App version: whatever the tracked VERSION file says. Deriving it from the git
# history does not work on Render — it builds from a shallow clone, so the
# commit count is always 1. Bump VERSION in the same commit as the change.
def _resolve_version() -> str:
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", "VERSION")) as f:
            return f.read().strip() or "dev"
    except OSError:
        return "dev"


APP_VERSION = _resolve_version()

# Session cookie lifetime: 60 days.
SESSION_MAX_AGE = 60 * 24 * 3600
