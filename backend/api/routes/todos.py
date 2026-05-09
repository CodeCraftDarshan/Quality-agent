from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.auth.jwt_utils import require_role
from backend.db.models import TodoItem
from backend.db.session import get_db
from backend.services.workspace_service import create_todo as create_todo_record, delete_todo as delete_todo_record, update_todo as update_todo_record

router = APIRouter()


class TodoCreateRequest(BaseModel):
    cluster_id: str
    text: str


class TodoUpdateRequest(BaseModel):
    text: str | None = None
    status: str | None = None


@router.get("/api/todos")
def get_todos(cluster_id: str, _: dict = Depends(require_role("admin", "moderator")), db: Session = Depends(get_db)):
    return (
        db.query(TodoItem)
        .filter(TodoItem.cluster_id == cluster_id)
        .order_by(TodoItem.created_at.desc())
        .all()
    )


@router.post("/api/todos")
def create_todo(req: TodoCreateRequest, _: dict = Depends(require_role("admin", "moderator")), db: Session = Depends(get_db)):
    return create_todo_record(db, req.cluster_id, req.text)


@router.patch("/api/todos/{todo_id}")
def update_todo(todo_id: int, req: TodoUpdateRequest, _: dict = Depends(require_role("admin", "moderator")), db: Session = Depends(get_db)):
    return update_todo_record(db, todo_id, text=req.text, status_value=req.status)


@router.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: int, _: dict = Depends(require_role("admin", "moderator")), db: Session = Depends(get_db)):
    return delete_todo_record(db, todo_id)
