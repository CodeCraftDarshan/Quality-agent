from fastapi import APIRouter, Depends, HTTPException

from backend.auth.jwt_utils import require_role
from backend.services.finops import get_daily_usage
from backend.risk_register import get_risk, load_risk_register
from backend.utils.audit import read_audit_entries

router = APIRouter()


@router.get("/api/audit")
def audit_endpoint(limit: int = 50, user_id: str | None = None, _: dict = Depends(require_role("admin"))):
    return read_audit_entries(limit=limit, user_id=user_id)


@router.get("/api/finops/usage")
def finops_usage_endpoint(date: str | None = None, user_id: str | None = None, _: dict = Depends(require_role("admin"))):
    return get_daily_usage(for_date=date, user_id=user_id)


@router.get("/api/risks")
def risks_endpoint(_: dict = Depends(require_role("admin"))):
    return load_risk_register()


@router.get("/api/risks/{risk_id}")
def risk_endpoint(risk_id: str, _: dict = Depends(require_role("admin"))):
    risk = get_risk(risk_id)
    if not risk:
        raise HTTPException(status_code=404, detail=f"Risk '{risk_id}' not found")
    return risk
