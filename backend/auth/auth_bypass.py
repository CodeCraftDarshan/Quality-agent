from backend.auth.bypass import get_bypass_users


def resolve_bypass_entry(email: str | None) -> dict | None:
    normalized_email = str(email or "").strip()
    if not normalized_email:
        return None
    return get_bypass_users().get(normalized_email)


def validate_bypass_credentials(email: str, password: str) -> bool:
    entry = resolve_bypass_entry(email)
    return bool(entry and entry.get("password") == password)


def get_mock_user_from_bypass(email: str | None = None) -> dict:
    entry = resolve_bypass_entry(email) or next(iter(get_bypass_users().values()), None)
    return {
        "id": str((entry or {}).get("email") or "bypass-temp-user"),
        "email": (entry or {}).get("email"),
        "role": (entry or {}).get("role", "registrar"),
        "sub": str((entry or {}).get("email") or "bypass-temp-user"),
    }
