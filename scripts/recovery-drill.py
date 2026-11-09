#!/usr/bin/env python3
"""Seed and erase one disposable account in a local Supabase recovery drill."""

import argparse
import json
import os
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request


def fail(message):
    raise SystemExit(message)


def request(base_url, service_key, path, method="GET", body=None, allow=()):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        if error.code in allow:
            return error.code, None
        fail(f"Local recovery drill request failed with HTTP {error.code}")


def read_decision(path):
    decision = json.loads(path.read_text(encoding="utf-8"))
    user_id = decision.get("user_id", "")
    if not re.fullmatch(r"[0-9a-f-]{36}", user_id):
        fail("The synthetic erasure decision is invalid")
    return user_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("seed", "erase", "verify-erased"))
    parser.add_argument("decision_file", type=pathlib.Path)
    args = parser.parse_args()

    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    host = urllib.parse.urlparse(base_url).hostname
    if host not in ("127.0.0.1", "localhost"):
        fail("Refusing to run the recovery drill against a non-local Supabase instance")

    if args.mode == "seed":
        run_id = re.sub(r"[^0-9]", "", os.environ.get("GITHUB_RUN_ID", "local")) or "local"
        email = f"recovery-{run_id}@privacy-acceptance.invalid"
        _, user = request(base_url, service_key, "/auth/v1/admin/users", "POST", {
            "email": email,
            "password": "synthetic-recovery-only-2026!",
            "email_confirm": True,
            "user_metadata": {"name": "Recovery Fixture"},
            "app_metadata": {
                "organization_id": "00000000-0000-0000-0000-000000000001",
                "admin_scope": "none",
            },
        })
        user_id = user.get("id", "") if isinstance(user, dict) else ""
        if not re.fullmatch(r"[0-9a-f-]{36}", user_id):
            fail("Local Auth did not create the synthetic fixture")
        request(base_url, service_key, "/rest/v1/profiles?on_conflict=id", "POST", {
            "id": user_id,
            "name": "Recovery Fixture",
            "organization_id": "00000000-0000-0000-0000-000000000001",
            "admin_scope": "none",
            "is_admin": False,
            "onboarding_complete": True,
            "job_title": "Synthetic only",
            "bio": "Must not survive erasure after restore",
        })
        request(base_url, service_key, "/rest/v1/skills", "POST", {
            "user_id": user_id,
            "skill": "Synthetic recovery fixture",
            "type": "can_teach",
        })
        args.decision_file.write_text(json.dumps({"user_id": user_id}), encoding="utf-8")
        print("Seeded one disposable local recovery fixture")
        return

    user_id = read_decision(args.decision_file)
    if args.mode == "erase":
        request(base_url, service_key, "/rest/v1/rpc/erase_account_data", "POST", {"p_user_id": user_id})
        request(base_url, service_key, f"/auth/v1/admin/users/{user_id}", "DELETE")
        request(base_url, service_key, "/rest/v1/rpc/complete_account_auth_cleanup", "POST", {"p_user_id": user_id})
        print("Applied the synthetic erasure decision to the source database")
        return

    status, _ = request(base_url, service_key, f"/auth/v1/admin/users/{user_id}", allow=(404,))
    if status != 404:
        fail("Synthetic Auth identity survived erasure")
    _, profiles = request(
        base_url,
        service_key,
        f"/rest/v1/profiles?id=eq.{user_id}&select=name,job_title,bio,erased_at,deactivated_at,ai_opt_out",
    )
    if not isinstance(profiles, list) or len(profiles) != 1:
        fail("Synthetic erased profile tombstone is missing")
    profile = profiles[0]
    if profile.get("name") != "Former member" or profile.get("job_title") or profile.get("bio"):
        fail("Synthetic profile was not scrubbed")
    if not profile.get("erased_at") or not profile.get("deactivated_at") or profile.get("ai_opt_out") is not True:
        fail("Synthetic erased profile state is incomplete")
    _, skills = request(base_url, service_key, f"/rest/v1/skills?user_id=eq.{user_id}&select=id")
    if skills != []:
        fail("Synthetic personal rows survived erasure")
    print("Verified source erasure without exposing fixture identifiers")


if __name__ == "__main__":
    main()
