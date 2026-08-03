"""App configuration from environment variables, with safe local-dev defaults."""
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/app.db")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "changeme")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-not-for-production")

# Session cookie lifetime: 60 days.
SESSION_MAX_AGE = 60 * 24 * 3600
