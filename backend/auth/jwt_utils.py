from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from backend.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY

APP_ROLES = {"admin", "moderator", "registrar"}
APP_ROLE_ALIASES = {
    "developer": "admin",
    "observer": "registrar",
    "viewer": "registrar",
    "qa": "moderator",
    "analyst": "moderator",
}

bearer_scheme = HTTPBearer()


def _normalize_app_role(*values: str | None) -> str:
    for value in values:
        normalized = str(value or "").strip().lower()
        normalized = APP_ROLE_ALIASES.get(normalized, normalized)
        if normalized in APP_ROLES:
            return normalized
    return "registrar"


def _build_user_payload(user_id: str | None, email: str | None, role: str | None, **extra) -> dict:
    payload = {
        "id": user_id,
        "email": email,
        "role": _normalize_app_role(role),
    }
    payload.update(extra)
    return payload


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        role = payload.get("role")
        if not email or not role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
        return _build_user_payload(
            str(email),
            payload.get("email") or str(email),
            str(role),
        )
    except HTTPException:
        raise
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc


def require_role(*allowed_roles: str):
    allowed = {_normalize_app_role(role) for role in allowed_roles}

    def checker(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return checker
