from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from backend.db.models import AgentExecutionRecord
from backend.db.session import SessionLocal

LOG_DIR = Path("logs")
AUDIT_LOG_PATH = LOG_DIR / "audit.jsonl"


def _ensure_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def append_audit_entry(entry: dict) -> dict:
    _ensure_log_dir()
    payload = {"timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), **entry}
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\n")
    _persist_execution_entry(payload)
    return payload


def read_audit_entries(limit: int = 50, user_id: str | None = None) -> list[dict]:
    db_entries = _read_db_audit_entries(limit=limit, user_id=user_id)
    if db_entries:
        return db_entries
    if not AUDIT_LOG_PATH.exists():
        return []

    entries: list[dict] = []
    with AUDIT_LOG_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if user_id and entry.get("user_id") != user_id:
                continue
            entries.append(entry)

    return list(reversed(entries[-max(1, limit) :]))


def _persist_execution_entry(entry: dict) -> None:
    db = SessionLocal()
    try:
        record = AgentExecutionRecord(
            request_id=str(entry.get("request_id") or ""),
            user_id=entry.get("user_id"),
            endpoint=entry.get("endpoint"),
            cluster_id=entry.get("cluster_id"),
            task_type_requested=entry.get("task_type_requested"),
            task_type_resolved=entry.get("task_type_resolved"),
            intent_resolved=entry.get("intent_resolved"),
            pipeline_name=entry.get("pipeline_name"),
            prompt_id=entry.get("prompt_id"),
            prompt_version=entry.get("prompt_version"),
            model=entry.get("ollama_model") or entry.get("model"),
            ollama_endpoint_used=entry.get("ollama_endpoint_used"),
            mode=entry.get("mode"),
            status=entry.get("status") or "success",
            fallback_used=bool(entry.get("fallback_used")),
            fallback_reason=entry.get("fallback_reason"),
            parse_status=entry.get("parse_status"),
            error_code=entry.get("error_code"),
            error_message=entry.get("error"),
            timing_ms=max(0, int(entry.get("timing_ms", 0) or 0)),
            token_estimate=max(0, int(entry.get("token_estimate", 0) or 0)),
            citations_count=max(0, int(entry.get("citations_count", 0) or 0)),
            hitl_flagged=bool(entry.get("hitl_flagged")),
            retrieval_ids_json=json.dumps(entry.get("retrieval_ids") or []),
            response_sections_json=json.dumps(entry.get("response_sections_present") or []),
            stage_timings_json=json.dumps(entry.get("stage_timings_ms") or {}),
            hitl_reasons_json=json.dumps(entry.get("hitl_reasons") or []),
            raw_payload_json=json.dumps(entry),
        )
        db.add(record)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _read_db_audit_entries(limit: int = 50, user_id: str | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        query = db.query(AgentExecutionRecord)
        if user_id:
            query = query.filter(AgentExecutionRecord.user_id == user_id)
        rows = query.order_by(AgentExecutionRecord.created_at.desc()).limit(max(1, limit)).all()
        entries: list[dict] = []
        for row in rows:
            try:
                payload = json.loads(row.raw_payload_json or "{}")
            except Exception:
                payload = {}
            payload.setdefault("timestamp", row.created_at.isoformat() + "Z" if row.created_at else None)
            entries.append(payload)
        return entries
    except Exception:
        return []
    finally:
        db.close()
