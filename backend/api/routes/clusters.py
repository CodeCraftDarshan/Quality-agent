from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.auth.jwt_utils import get_current_user, require_role
from backend.db.models import ComplaintCluster, InvestigationTicket
from backend.db.session import get_db
from backend.services.workspace_service import (
    create_cluster as create_cluster_record,
    get_resolution_view,
    update_cluster as update_cluster_record,
    update_resolution_view,
)

router = APIRouter()
_CLUSTER_COLUMNS_CACHE: list[str] | None = None


class ClusterCreateRequest(BaseModel):
    cluster_id: str
    title: str
    sku: str | None = None
    defect_family: str | None = None
    count: int | None = None
    first_seen: str | None = None
    last_seen: str | None = None
    confidence: float | None = None
    severity: str
    ai_summary: str | None = None


class ClusterUpdateRequest(BaseModel):
    title: str | None = None
    sku: str | None = None
    defect_family: str | None = None
    count: int | None = None
    first_seen: str | None = None
    last_seen: str | None = None
    confidence: float | None = None
    severity: str | None = None
    ai_summary: str | None = None


class ResolutionLogInput(BaseModel):
    actor: str
    message: str
    status: str = "done"
    time: str | None = None


class ResolutionRecordPatch(BaseModel):
    draft_text: str | None = None
    locked: bool | None = None
    challenge_notes: str | None = None
    append_log: ResolutionLogInput | None = None


class ClusterResolveRequest(BaseModel):
    resolution_notes: str | None = None


class ClusterStatusRequest(BaseModel):
    status: str


class BulkResolveRequest(BaseModel):
    cluster_ids: list[str]
    resolution_notes: str | None = None


def _get_cluster_or_404(db: Session, cluster_id: str) -> ComplaintCluster:
    cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster '{cluster_id}' not found")
    return cluster


def _get_cluster_table_columns(db) -> list[str]:
    global _CLUSTER_COLUMNS_CACHE
    if _CLUSTER_COLUMNS_CACHE is not None:
        return _CLUSTER_COLUMNS_CACHE
    inspector = inspect(db.bind)
    _CLUSTER_COLUMNS_CACHE = [
        col["name"] for col in inspector.get_columns("complaint_clusters")
    ]
    return _CLUSTER_COLUMNS_CACHE


def _fetch_cluster_rows(db: Session, cluster_id: str | None = None) -> list[dict]:
    available_columns = set(_get_cluster_table_columns(db))
    base_columns = [
        "cluster_id",
        "title",
        "sku",
        "defect_family",
        "count",
        "first_seen",
        "last_seen",
        "confidence",
        "severity",
        "ai_summary",
        "updated_at",
        "updated_by",
    ]
    optional_defaults = {
        "status": "open",
        "resolved_at": None,
        "resolution_notes": None,
    }
    select_columns = [column for column in base_columns if column in available_columns]
    select_columns.extend(column for column in optional_defaults if column in available_columns)

    if not select_columns:
        return []

    query = f"SELECT {', '.join(select_columns)} FROM complaint_clusters"
    params: dict[str, str] = {}
    if cluster_id is not None:
        query += " WHERE cluster_id = :cluster_id"
        params["cluster_id"] = cluster_id
    query += " ORDER BY cluster_id ASC"

    rows = [dict(row) for row in db.execute(text(query), params).mappings().all()]
    for row in rows:
        for field_name, default_value in optional_defaults.items():
            row.setdefault(field_name, default_value)
    return rows


@router.get("/api/clusters")
def get_clusters(_: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return _fetch_cluster_rows(db)


@router.post("/api/clusters")
def create_cluster(req: ClusterCreateRequest, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return create_cluster_record(db, req, user)


@router.patch("/api/clusters/bulk-resolve")
def bulk_resolve_clusters(
    req: BulkResolveRequest,
    user: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    resolved = []
    failed = []
    resolved_at = datetime.now(timezone.utc).isoformat()
    notes = (req.resolution_notes or "").strip() or None
    actor = user.get("email") or user.get("id")

    try:
        for cluster_id in req.cluster_ids:
            cluster = db.query(ComplaintCluster).filter(ComplaintCluster.cluster_id == cluster_id).first()
            if not cluster:
                failed.append(cluster_id)
                continue
            cluster.status = "resolved"
            cluster.resolved_at = resolved_at
            cluster.resolution_notes = notes
            cluster.updated_by = actor
            resolved.append(cluster_id)

        if failed:
            db.rollback()
            return {"resolved": [], "failed": failed}

        db.commit()
        return {"resolved": resolved, "failed": failed}
    except Exception:
        db.rollback()
        raise


@router.patch("/api/clusters/{cluster_id}")
def update_cluster(cluster_id: str, req: ClusterUpdateRequest, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return update_cluster_record(db, cluster_id, req, user)


@router.get("/api/clusters/{cluster_id}")
def get_cluster(cluster_id: str, _: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    cluster_rows = _fetch_cluster_rows(db, cluster_id=cluster_id)
    if not cluster_rows:
        raise HTTPException(status_code=404, detail=f"Cluster '{cluster_id}' not found")
    tickets = db.query(InvestigationTicket).filter(InvestigationTicket.cluster_id == cluster_id).all()
    return {"cluster": cluster_rows[0], "tickets": tickets}


@router.patch("/api/clusters/{cluster_id}/resolve")
def resolve_cluster(
    cluster_id: str,
    req: ClusterResolveRequest,
    user: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    cluster = _get_cluster_or_404(db, cluster_id)
    cluster.status = "resolved"
    cluster.resolved_at = datetime.now(timezone.utc).isoformat()
    cluster.resolution_notes = (req.resolution_notes or "").strip() or None
    cluster.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(cluster)
    return cluster


@router.patch("/api/clusters/{cluster_id}/reopen")
def reopen_cluster(
    cluster_id: str,
    user: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    cluster = _get_cluster_or_404(db, cluster_id)
    cluster.status = "open"
    cluster.resolved_at = None
    cluster.resolution_notes = None
    cluster.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(cluster)
    return cluster


@router.patch("/api/clusters/{cluster_id}/status")
def update_cluster_status(
    cluster_id: str,
    req: ClusterStatusRequest,
    user: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    next_status = str(req.status or "").strip()
    allowed_statuses = {"open", "under_investigation", "resolved"}
    if next_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Status must be one of open, under_investigation, resolved",
        )
    cluster = _get_cluster_or_404(db, cluster_id)
    cluster.status = next_status
    cluster.updated_by = user.get("email") or user.get("id")
    db.commit()
    db.refresh(cluster)
    return cluster


@router.get("/api/resolution/{cluster_id}")
def get_resolution_record(cluster_id: str, _: dict = Depends(require_role("admin", "moderator")), db: Session = Depends(get_db)):
    return get_resolution_view(db, cluster_id)


@router.patch("/api/resolution/{cluster_id}")
def update_resolution_record(
    cluster_id: str,
    req: ResolutionRecordPatch,
    _: dict = Depends(require_role("admin", "moderator")),
    db: Session = Depends(get_db),
):
    return update_resolution_view(
        db,
        cluster_id,
        draft_text=req.draft_text,
        locked=req.locked,
        challenge_notes=req.challenge_notes,
        append_log=req.append_log.model_dump() if req.append_log else None,
    )
