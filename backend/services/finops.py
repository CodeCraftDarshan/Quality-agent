from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

from backend.utils.metrics import record_tokens

logger = logging.getLogger(__name__)

LOG_DIR = Path("logs")
TOKEN_USAGE_PATH = LOG_DIR / "token_usage.jsonl"


def estimate_tokens(text: str) -> int:
    return int(len((text or "").split()) * 1.3)


def _ensure_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def record_usage(user_id: str, tokens: int, model: str, endpoint: str):
    _ensure_log_dir()
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "user_id": user_id,
        "tokens": max(0, int(tokens)),
        "model": model,
        "endpoint": endpoint,
    }
    with TOKEN_USAGE_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")

    record_tokens(entry["tokens"])

    budget = int(os.getenv("DAILY_TOKEN_BUDGET", "100000") or "100000")
    daily = get_daily_usage(date.today().isoformat())
    if daily["total_tokens"] > budget:
        logger.warning("Daily token budget exceeded: %s > %s", daily["total_tokens"], budget)


def get_daily_usage(for_date: str | None = None, user_id: str | None = None) -> dict:
    target_date = for_date or date.today().isoformat()
    totals_by_user: dict[str, int] = defaultdict(int)
    total_tokens = 0

    if not TOKEN_USAGE_PATH.exists():
        return {"date": target_date, "total_tokens": 0, "by_user": {}}

    with TOKEN_USAGE_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            entry_date = str(entry.get("timestamp", "")).split("T")[0]
            if entry_date != target_date:
                continue
            entry_user = entry.get("user_id") or "unknown"
            if user_id and entry_user != user_id:
                continue
            tokens = int(entry.get("tokens", 0) or 0)
            total_tokens += tokens
            totals_by_user[entry_user] += tokens

    return {"date": target_date, "total_tokens": total_tokens, "by_user": dict(totals_by_user)}
