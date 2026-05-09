from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.auth.jwt_utils import get_current_user, require_role
from backend.db.models import InvestigationTicket
from backend.db.session import get_db
from backend.services.workspace_service import create_ticket as create_ticket_record, delete_ticket as delete_ticket_record, update_ticket as update_ticket_record

router = APIRouter()


class TicketCreateRequest(BaseModel):
    ticket_id: str
    cluster_id: str
    timestamp: str | None = None
    content: str
    severity: str
    associated_sku: str | None = None


class TicketUpdateRequest(BaseModel):
    cluster_id: str | None = None
    timestamp: str | None = None
    content: str | None = None
    severity: str | None = None
    associated_sku: str | None = None


@router.get("/api/tickets")
def get_tickets(_: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(InvestigationTicket).order_by(InvestigationTicket.updated_at.desc()).limit(20).all()


@router.post("/api/tickets")
def create_ticket(req: TicketCreateRequest, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return create_ticket_record(db, req, user)


@router.patch("/api/tickets/{ticket_id}")
def update_ticket(ticket_id: str, req: TicketUpdateRequest, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return update_ticket_record(db, ticket_id, req, user)


@router.delete("/api/tickets/{ticket_id}")
def delete_ticket(
    ticket_id: str,
    _: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return delete_ticket_record(db, ticket_id)
