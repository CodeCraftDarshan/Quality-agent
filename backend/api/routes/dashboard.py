import os

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.auth.jwt_utils import get_current_user, require_role
from backend.core.config import OLLAMA_BASE_URL
from backend.db.models import ComplaintCluster, InvestigationTicket
from backend.db.session import engine, get_db
from backend.utils.metrics import snapshot_metrics

router = APIRouter()


@router.get("/api/health")
def healthcheck():
    db_status = "ok"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "dependencies": {
            "database": db_status,
            "llm": "configured" if bool(OLLAMA_BASE_URL) else "missing_config",
            "pinecone": "configured" if bool(os.getenv("PINECONE_API_KEY")) else "missing_config",
        },
    }


@router.get("/api/v2/health")
def healthcheck_v2():
    return {"status": "ok", "version": "2", "agent": "ollama"}


@router.get("/api/metrics")
def metrics_endpoint(_: dict = Depends(require_role("admin"))):
    return snapshot_metrics()


@router.get("/api/dashboard/stats")
def get_stats(_: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    total_intake = db.query(InvestigationTicket).count()
    active_clusters = db.query(ComplaintCluster).count()
    suppliers_at_risk = len(
        {
            sku
            for (sku,) in db.query(ComplaintCluster.sku).filter(ComplaintCluster.sku.isnot(None)).all()
            if sku
        }
    )
    return {
        "totalIntake": total_intake,
        "activeClusters": active_clusters,
        "suppliersAtRisk": suppliers_at_risk,
    }
