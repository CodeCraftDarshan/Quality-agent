#!/usr/bin/env python3
"""Create bypass users in Supabase using the Admin API.

Reads `AUTH_BYPASS_ENTRIES` from env (format: email:password:role;...) and
uses `SUPABASE_PROJECT_URL` and `SUPABASE_SECRET_KEY` to create users via
the Supabase Admin endpoint `/auth/v1/admin/users`.

Run locally with the project env loaded, e.g.:
  python backend/create_bypass_users.py
"""
import os
import json
import sys
from typing import List, Dict

try:
    from backend.env_loader import load_backend_env
except Exception:
    from backend.env_loader import load_backend_env


def parse_entries(raw: str) -> List[Dict[str, str]]:
    items = []
    raw = (raw or "").strip()
    if not raw:
        return items
    for part in raw.split(";"):
        piece = part.strip()
        if not piece:
            continue
        parts = [p.strip() for p in piece.split(":")]
        if len(parts) < 2:
            continue
        email = parts[0]
        password = parts[1]
        role = parts[2].lower() if len(parts) >= 3 and parts[2].strip() else "user"
        items.append({"email": email, "password": password, "role": role})
    return items


def create_user(supabase_url: str, service_key: str, entry: Dict[str, str]) -> Dict:
    import requests

    url = supabase_url.rstrip("/") + "/auth/v1/admin/users"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": entry["email"],
        "password": entry["password"],
        "email_confirm": True,
        "user_metadata": {"role": entry.get("role")},
    }
    resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=30)
    try:
        body = resp.json()
    except Exception:
        body = {"status_text": resp.text}
    return {"status_code": resp.status_code, "body": body}


def main():
    load_backend_env()
    supabase_url = os.getenv("SUPABASE_PROJECT_URL")
    service_key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    raw = os.getenv("AUTH_BYPASS_ENTRIES", "")

    if not supabase_url or not service_key:
        print("Error: SUPABASE_PROJECT_URL and SUPABASE_SECRET_KEY must be set in env.")
        sys.exit(1)

    entries = parse_entries(raw)
    if not entries:
        print("No AUTH_BYPASS_ENTRIES found; nothing to do.")
        return

    print(f"Found {len(entries)} bypass entries, creating users in Supabase...")
    for entry in entries:
        print(f"- Creating {entry['email']} (role={entry.get('role')})...", end=" ")
        try:
            result = create_user(supabase_url, service_key, entry)
        except Exception as e:
            print(f"failed: {e}")
            continue
        code = result.get("status_code")
        if code and 200 <= code < 300:
            print("ok")
        elif code == 409:
            print("already exists")
        else:
            print(f"error (status={code}): {result.get('body')}")


if __name__ == "__main__":
    main()
