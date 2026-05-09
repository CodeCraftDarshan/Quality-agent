import os
from pathlib import Path

from backend.env_loader import load_backend_env

load_backend_env()

BASE_DIR = Path(__file__).resolve().parents[1]
SQLITE_DB_PATH = BASE_DIR.parent / "auraqc.db"
SQLITE_DATABASE_URL = f"sqlite:///{SQLITE_DB_PATH.as_posix()}"

SUPABASE_DATABASE_URL = (os.getenv("SUPABASE_DATABASE_URL") or "").strip()
HAS_REAL_SUPABASE_URL = bool(
    SUPABASE_DATABASE_URL
    and "://" in SUPABASE_DATABASE_URL
    and not SUPABASE_DATABASE_URL.upper().startswith("REPLACE_")
)
DATABASE_URL = SUPABASE_DATABASE_URL if HAS_REAL_SUPABASE_URL else SQLITE_DATABASE_URL

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

CHAT_RATE_LIMIT_PER_MINUTE = max(1, int(os.getenv("CHAT_RATE_LIMIT_PER_MINUTE", "20")))
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")

AUTH_BYPASS_ENTRIES = os.getenv("AUTH_BYPASS_ENTRIES", "")

DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
]
ALLOW_CREDENTIALS = "*" not in ALLOWED_ORIGINS
