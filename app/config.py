"""App configuration from environment variables, with safe local-dev defaults."""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/app.db")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "changeme")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-not-for-production")

# App version = "0.0.<commit count on HEAD>" — bumps automatically on every commit.
# Resolution: VERSION file (written by the Render build) -> local git -> "dev".
def _resolve_version() -> str:
    try:
        with open("VERSION") as f:
            count = f.read().strip()
            if count.isdigit():
                return f"0.0.{count}"
    except OSError:
        pass
    try:
        import subprocess

        r = subprocess.run(
            ["git", "rev-list", "--count", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode == 0 and r.stdout.strip().isdigit():
            return f"0.0.{r.stdout.strip()}"
    except Exception:
        pass
    return "dev"


APP_VERSION = _resolve_version()

# Session cookie lifetime: 60 days.
SESSION_MAX_AGE = 60 * 24 * 3600
