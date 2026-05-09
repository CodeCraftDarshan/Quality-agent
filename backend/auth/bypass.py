import os

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.jwt_utils import create_access_token
from backend.auth.jwt_utils import get_current_user
from backend.auth.schemas import LoginRequest
from backend.env_loader import load_backend_env

router = APIRouter()


def _parse_bypass_entries() -> dict[str, dict]:
    load_backend_env()
    result: dict[str, dict] = {}
    raw_entries = os.getenv("AUTH_BYPASS_ENTRIES", "")
    for entry in raw_entries.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            continue
        email, password, role = parts
        result[email.strip()] = {
            "password": password.strip(),
            "role": role.strip(),
            "email": email.strip(),
        }
    return result


def get_bypass_users() -> dict[str, dict]:
    return _parse_bypass_entries()


def authenticate_bypass_user(email: str, password: str) -> dict:
    bypass_users = get_bypass_users()
    user = bypass_users.get(email)
    if not user or user["password"] != password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(
        {
            "sub": email,
            "role": user["role"],
            "email": email,
        }
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "email": email,
    }


@router.post("/api/login")
def login(body: LoginRequest):
    return authenticate_bypass_user(body.email, body.password)


@router.get("/api/me")
def me_endpoint(user: dict = Depends(get_current_user)):
    return {
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
        },
        "role": user.get("role") or "registrar",
    }
