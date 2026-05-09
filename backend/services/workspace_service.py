from __future__ import annotations

import json
import time

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.db.models import ComplaintCluster, InvestigationTicket, ResolutionRecord, TodoItem


def normalize_todo_text(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def normalize_cluster_id(value: str) -> str:
    return str(value or "").strip()


def normalize_ticket_id(value: str) -> str:
    return str(value or "").strip()


def validate_required_text(value: str | None, field_name: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field_name} is required")
    return cleaned


def validate_confidence(value: float | None) -> float | None:
    if value is None:
        return None
    if value < 0 or value > 1:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Confidence must be between 0 and 1")
    return float(value)


def default_resolution_draft(cluster: ComplaintCluster) -> str:
    batch_label = cluster.cluster_id or cluster.sku or "UNKNOWN-BATCH"
    return (
        f"URGENT: Quality Control Notice - {batch_label}\n\n"
        "Dear Supplier Quality Team,\n\n"
        f"We are investigating a quality anomaly linked to cluster {cluster.cluster_id} "
        f"for SKU {cluster.sku or 'unknown'}.\n\n"
        f"Defect Family: {cluster.defect_family or 'under investigation'}\n"
        f"Severity Level: {cluster.severity or 'High'}\n"
        f"Cluster Confidence: {cluster.confidence or 0}\n\n"
        "Immediate actions requested:\n"
        "- Hold impacted material and finished goods associated with this cluster.\n"
        "- Review recent production, packaging, and handling records for deviations.\n"
        "- Share containment status and any corroborating evidence with the investigation team.\n"
    )


def parse_resolution_logs(raw_value: str | None) -> list[dict]:
    try:
        parsed = json.loads(raw_value or "[]")
    except Exception:
        parsed = []
    return parsed if isinstance(parsed, list) else []


def serialize_resolution_record(record: ResolutionRecord, todos: list[TodoItem]) -> dict:
    completed = sum(1 for todo in todos if todo.status == "completed")
    total = len(todos)
    progress = int(round((completed / total) * 100)) if total else 0
    return {
        "cluster_id": record.cluster_id,
        "draft_text": record.draft_text,
        "locked": bool(record.locked),
        "challenge_notes": record.challenge_notes,
        "log_items": parse_resolution_logs(record.log_items_json),
        "progress": progress,
        "completed_count": completed,
        "total_count": total,
    }


def get_or_create_resolution_record(db: Session, cluster_id: str) -> tuple[ComplaintCluster, ResolutionRecord]:
    cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster '{cluster_id}' not found")

    record = db.query(ResolutionRecord).filter(ResolutionRecord.cluster_id == cluster_id).first()
    if not record:
        record = ResolutionRecord(
            cluster_id=cluster_id,
            draft_text=default_resolution_draft(cluster),
            locked=False,
            challenge_notes=None,
            log_items_json=json.dumps(
                [
                    {
                        "id": f"bootstrap-{cluster_id}",
                        "actor": "System",
                        "message": f"Initialized resolution workspace for {cluster_id}",
                        "time": "Just now",
                        "status": "done",
                    }
                ]
            ),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    return cluster, record


def get_resolution_view(db: Session, cluster_id: str) -> dict:
    _, record = get_or_create_resolution_record(db, cluster_id)
    todos = (
        db.query(TodoItem)
        .filter(TodoItem.cluster_id == cluster_id)
        .order_by(TodoItem.created_at.desc())
        .all()
    )
    return serialize_resolution_record(record, todos)


def update_resolution_view(
    db: Session,
    cluster_id: str,
    *,
    draft_text: str | None = None,
    locked: bool | None = None,
    challenge_notes: str | None = None,
    append_log: dict | None = None,
) -> dict:
    cluster, record = get_or_create_resolution_record(db, cluster_id)
    changed = False

    if locked is not None:
        record.locked = locked
        changed = True

    if challenge_notes is not None:
        record.challenge_notes = challenge_notes.strip() or None
        changed = True

    if draft_text is not None:
        next_draft = draft_text.strip()
        record.draft_text = next_draft if next_draft else default_resolution_draft(cluster)
        changed = True

    if append_log is not None:
        log_items = parse_resolution_logs(record.log_items_json)
        log_items.insert(
            0,
            {
                "id": f"log-{int(time.time() * 1000)}",
                "actor": str(append_log.get("actor") or "").strip() or "Analyst",
                "message": str(append_log.get("message") or "").strip() or "Updated resolution workspace",
                "time": append_log.get("time") or "Just now",
                "status": str(append_log.get("status") or "").strip() or "done",
            },
        )
        record.log_items_json = json.dumps(log_items[:50])
        changed = True

    if changed:
        db.commit()
        db.refresh(record)

    todos = (
        db.query(TodoItem)
        .filter(TodoItem.cluster_id == cluster_id)
        .order_by(TodoItem.created_at.desc())
        .all()
    )
    return serialize_resolution_record(record, todos)


def create_todo(db: Session, cluster_id: str, text: str):
    text_value = text.strip()
    if not text_value:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Todo text is required")
    normalized_text = normalize_todo_text(text_value)
    existing = (
        db.query(TodoItem)
        .filter(TodoItem.cluster_id == cluster_id)
        .order_by(TodoItem.created_at.desc())
        .all()
    )
    for todo in existing:
        if normalize_todo_text(todo.text) == normalized_text:
            return todo
    todo = TodoItem(cluster_id=cluster_id, text=text_value, status="pending")
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def update_todo(db: Session, todo_id: int, *, text: str | None = None, status_value: str | None = None):
    todo = db.query(TodoItem).filter(TodoItem.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Todo '{todo_id}' not found")

    if text is not None:
        next_text = text.strip()
        if not next_text:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Todo text cannot be empty")
        todo.text = next_text

    if status_value is not None:
        if status_value not in {"pending", "completed"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Todo status must be pending or completed")
        todo.status = status_value

    db.commit()
    db.refresh(todo)
    return todo


def delete_todo(db: Session, todo_id: int) -> dict:
    todo = db.query(TodoItem).filter(TodoItem.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Todo '{todo_id}' not found")
    db.delete(todo)
    db.commit()
    return {"deleted": True, "id": todo_id}


def create_cluster(db: Session, req, user: dict):
    cluster_id = normalize_cluster_id(req.cluster_id)
    if not cluster_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="cluster_id is required")
    if db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cluster '{cluster_id}' already exists")

    cluster = ComplaintCluster(
        cluster_id=cluster_id,
        title=validate_required_text(req.title, "title"),
        sku=(req.sku or "").strip() or None,
        defect_family=(req.defect_family or "").strip() or None,
        count=max(0, int(req.count or 0)),
        first_seen=(req.first_seen or "").strip() or None,
        last_seen=(req.last_seen or "").strip() or None,
        confidence=validate_confidence(req.confidence),
        severity=validate_required_text(req.severity, "severity"),
        ai_summary=(req.ai_summary or "").strip() or None,
        updated_by=user.get("email") or user.get("id"),
    )
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    return cluster


def update_cluster(db: Session, cluster_id: str, req, user: dict):
    cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cluster '{cluster_id}' not found")

    if req.title is not None:
        cluster.title = validate_required_text(req.title, "title")
    if req.sku is not None:
        cluster.sku = req.sku.strip() or None
    if req.defect_family is not None:
        cluster.defect_family = req.defect_family.strip() or None
    if req.count is not None:
        cluster.count = max(0, int(req.count))
    if req.first_seen is not None:
        cluster.first_seen = req.first_seen.strip() or None
    if req.last_seen is not None:
        cluster.last_seen = req.last_seen.strip() or None
    if req.confidence is not None:
        cluster.confidence = validate_confidence(req.confidence)
    if req.severity is not None:
        cluster.severity = validate_required_text(req.severity, "severity")
    if req.ai_summary is not None:
        cluster.ai_summary = req.ai_summary.strip() or None

    cluster.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(cluster)
    return cluster


def create_ticket(db: Session, req, user: dict):
    ticket_id = normalize_ticket_id(req.ticket_id)
    cluster_id = normalize_cluster_id(req.cluster_id)
    if not ticket_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ticket_id is required")
    if not cluster_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="cluster_id is required")
    if db.query(InvestigationTicket).filter(InvestigationTicket.ticket_id == ticket_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Ticket '{ticket_id}' already exists")

    cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cluster '{cluster_id}' not found")

    ticket = InvestigationTicket(
        ticket_id=ticket_id,
        cluster_id=cluster_id,
        timestamp=(req.timestamp or "").strip() or "Just now",
        content=validate_required_text(req.content, "content"),
        severity=validate_required_text(req.severity, "severity"),
        associated_sku=(req.associated_sku or "").strip() or cluster.sku,
        updated_by=user.get("email") or user.get("id"),
    )
    db.add(ticket)
    cluster.count = int(cluster.count or 0) + 1
    if not cluster.first_seen:
        cluster.first_seen = ticket.timestamp
    cluster.last_seen = ticket.timestamp
    cluster.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(ticket)
    return ticket


def update_ticket(db: Session, ticket_id: str, req, user: dict):
    normalized_ticket_id = normalize_ticket_id(ticket_id)
    ticket = db.query(InvestigationTicket).filter(InvestigationTicket.ticket_id == normalized_ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Ticket '{ticket_id}' not found")

    next_cluster_id = normalize_cluster_id(req.cluster_id) if req.cluster_id is not None else ticket.cluster_id
    if not next_cluster_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="cluster_id is required")

    cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == next_cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cluster '{next_cluster_id}' not found")

    if req.cluster_id is not None:
        ticket.cluster_id = next_cluster_id
    if req.timestamp is not None:
        ticket.timestamp = req.timestamp.strip() or "Just now"
    if req.content is not None:
        ticket.content = validate_required_text(req.content, "content")
    if req.severity is not None:
        ticket.severity = validate_required_text(req.severity, "severity")
    if req.associated_sku is not None:
        ticket.associated_sku = req.associated_sku.strip() or cluster.sku

    ticket.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(ticket)
    return ticket


def delete_ticket(db: Session, ticket_id: str) -> dict:
    normalized_ticket_id = normalize_ticket_id(ticket_id)
    ticket = db.query(InvestigationTicket).filter(InvestigationTicket.ticket_id == normalized_ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Ticket '{ticket_id}' not found")

    db.delete(ticket)
    db.commit()
    return {"deleted": True, "ticket_id": normalized_ticket_id}
