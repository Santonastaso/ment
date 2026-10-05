#!/usr/bin/env python3
"""Create disposable local Auth users for the pre-release RLS smoke suite."""
import json
import os
import urllib.parse
import urllib.request

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
if urllib.parse.urlparse(url).hostname not in ("127.0.0.1", "localhost"):
    raise SystemExit("Refusing to seed a non-local Supabase instance")

organization_id = "00000000-0000-0000-0000-000000000001"
users = (
    ("MENT_EMP_EMAIL", "MENT_EMP_PASSWORD", "Bob Local", "none"),
    ("MENT_ADMIN_EMAIL", "MENT_ADMIN_PASSWORD", "Alice Local", "platform"),
    ("MENT_PEER_EMAIL", "MENT_PEER_PASSWORD", "Peer Local", "none"),
)

for email_key, password_key, name, scope in users:
    body = json.dumps({
        "email": os.environ[email_key],
        "password": os.environ[password_key],
        "email_confirm": True,
        "user_metadata": {"name": name},
        "app_metadata": {"organization_id": organization_id, "admin_scope": scope},
    }).encode()
    request = urllib.request.Request(
        f"{url}/auth/v1/admin/users", data=body, method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        user = json.load(response)
    if not user.get("id"):
        raise SystemExit(f"Failed to create local fixture {name}")
    print(f"Seeded {name}")
