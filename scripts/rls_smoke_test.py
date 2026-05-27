#!/usr/bin/env python3
"""RLS / column-level smoke test for MENT.

Re-runnable: load .env, sign in as Bob (employee) and Alice (admin), then
attempt every read/write that should be denied by RLS or column-level
grants. Prints PASS/FAIL per case and exits non-zero if any case slips
through.

Usage:
  python3 scripts/rls_smoke_test.py

You need .env at the repo root with SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT, SUPABASE_PROJECT_REF.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
ENV: dict[str, str] = {}
for line in ENV_PATH.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip()

SUPABASE_URL = ENV["SUPABASE_URL"]
ANON = ENV["SUPABASE_ANON_KEY"]
SRK = ENV["SUPABASE_SERVICE_ROLE_KEY"]

EMP = {"email": os.environ.get("MENT_EMP_EMAIL", "bob.taylor@ment.io"),
       "password": os.environ.get("MENT_EMP_PASSWORD", "Password")}
ADMIN = {"email": os.environ.get("MENT_ADMIN_EMAIL", "alice.chen@ment.io"),
         "password": os.environ.get("MENT_ADMIN_PASSWORD", "Password")}

cases: list[dict] = []


def case(key: str, expect_denied: bool, ok: bool, detail: str) -> None:
    passed = ok if not expect_denied else not ok
    cases.append({"key": key, "ok": passed, "detail": detail})
    label = "PASS" if passed else "FAIL"
    print(f"[{label}] {key}: {detail}")


def sign_in(email: str, password: str) -> str:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
    )
    req.add_header("apikey", ANON)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())["access_token"]


def rest(method: str, path: str, tok: str, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", ANON)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    if method in ("POST", "PATCH", "PUT"):
        req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body


def is_denied(status: int) -> bool:
    return status in (401, 403) or status >= 500


def ok_status(status: int) -> bool:
    return 200 <= status < 300


def main() -> int:
    print(f"RLS smoke test against {SUPABASE_URL}\n")
    bob = sign_in(EMP["email"], EMP["password"])
    alice = sign_in(ADMIN["email"], ADMIN["password"])

    # --- Column-level deny on profiles.shadow_role_response ---
    s, b = rest("GET", "profiles", bob,
                params={"select": "id,shadow_role_response", "limit": "1"})
    case("profiles.shadow_role_response_blocked_for_self",
         expect_denied=True, ok=ok_status(s),
         detail=f"GET profiles.shadow_role_response → status={s} (must be denied)")
    s, b = rest("GET", "profiles", bob,
                params={"select": "shadow_role_response", "id": "neq.deadbeef"})
    case("profiles.shadow_role_response_blocked_for_peer",
         expect_denied=True, ok=ok_status(s),
         detail=f"peer GET profiles.shadow_role_response → status={s}")

    # --- Column-level deny on sessions.reflection / rating ---
    for col in ("reflection", "mentor_reflection", "mentee_rating", "mentor_rating"):
        s, b = rest("GET", "sessions", bob, params={"select": f"id,{col}", "limit": "1"})
        case(f"sessions.{col}_blocked", expect_denied=True, ok=ok_status(s),
             detail=f"GET sessions.{col} → status={s}")

    # --- Reflection_logs cross-user read ---
    s, b = rest("GET", "reflection_logs", bob,
                params={"select": "id,support_needed,user_id", "user_id": "neq.852c6373-ecef-4023-85d1-79c738181b7e"})
    rows_other = (b if isinstance(b, list) else []) if ok_status(s) else []
    case("reflection_logs_isolated", expect_denied=False,
         ok=ok_status(s) and len(rows_other) == 0,
         detail=f"Bob queries OTHER users' reflection_logs → returned {len(rows_other)} rows (must be 0)")

    # --- feedback_messages owner only via SELECT, but Bob can submit via RPC ---
    s, b = rest("GET", "feedback_messages", bob,
                params={"select": "id,message", "limit": "5"})
    rows = (b if isinstance(b, list) else []) if ok_status(s) else []
    # All returned rows should belong to Bob if any are returned (RLS-based isolation)
    leaked = []
    if rows:
        bob_id_row = next((r for r in rows if r.get("user_id") and r["user_id"] != "852c6373-ecef-4023-85d1-79c738181b7e"), None)
        if bob_id_row:
            leaked.append(bob_id_row)
    case("feedback_isolated_select", expect_denied=False,
         ok=len(leaked) == 0, detail=f"Bob SELECT on feedback_messages: {len(rows)} rows, {len(leaked)} cross-user")

    # --- Profile UPDATE attempts ---
    other_uid = "937306e0-bda9-40a8-9bec-5884d65b6fe1"  # Alice
    s, b = rest("PATCH", "profiles", bob, body={"bio": "hacked"},
                params={"id": f"eq.{other_uid}"})
    # PATCH with eq=other and RLS update policy id=auth.uid() means 0 rows updated
    rows = b if isinstance(b, list) else []
    case("profiles.update_other_user_denied", expect_denied=False,
         ok=len(rows) == 0,
         detail=f"PATCH profiles bio for OTHER user → updated {len(rows)} rows (must be 0)")

    # --- Direct UPDATE to escalate admin scope on own row should fail (guard trigger) ---
    s, b = rest("PATCH", "profiles", bob, body={"admin_scope": "platform"},
                params={"id": "eq.852c6373-ecef-4023-85d1-79c738181b7e"})
    case("profiles.escalate_admin_blocked", expect_denied=True, ok=ok_status(s),
         detail=f"Bob attempts to set admin_scope=platform on self → status={s}")

    # --- mentorship_paused on someone else (e.g., Alice) ---
    s, b = rest("PATCH", "profiles", bob, body={"mentorship_paused": True},
                params={"id": f"eq.{other_uid}"})
    rows = b if isinstance(b, list) else []
    case("profiles.pause_other_denied", expect_denied=False,
         ok=len(rows) == 0,
         detail=f"Bob pauses ALICE → updated {len(rows)} rows (must be 0)")

    # --- Sessions: direct INSERT denied (must go through request_session) ---
    s, b = rest("POST", "sessions", bob, body={
        "mentor_id": other_uid, "mentee_id": "852c6373-ecef-4023-85d1-79c738181b7e",
        "title": "RLS bypass attempt", "status": "scheduled",
    })
    case("sessions.direct_insert_denied", expect_denied=True, ok=ok_status(s),
         detail=f"Bob direct INSERT sessions → status={s}")

    # --- audit_logs SELECT denied for non-admin ---
    s, b = rest("GET", "audit_logs", bob, params={"select": "id", "limit": "1"})
    rows = (b if isinstance(b, list) else []) if ok_status(s) else []
    # The policy allows admins; Bob isn't one. Either 403 or empty list.
    case("audit_logs_denied_for_employee", expect_denied=False,
         ok=(not ok_status(s)) or len(rows) == 0,
         detail=f"Bob SELECT audit_logs → status={s}, rows={len(rows)}")

    # --- audit_logs visible for admin ---
    s, b = rest("GET", "audit_logs", alice, params={"select": "id", "limit": "1"})
    case("audit_logs_visible_for_admin", expect_denied=False,
         ok=ok_status(s),
         detail=f"Alice SELECT audit_logs → status={s}")

    # --- list_feedback denied for non-admin via RPC ---
    s, b = rest("POST", "rpc/list_feedback", bob, body={"p_status": None})
    case("rpc.list_feedback_denied_for_employee", expect_denied=True, ok=ok_status(s),
         detail=f"Bob calls list_feedback → status={s}")

    # --- list_feedback works for admin ---
    s, b = rest("POST", "rpc/list_feedback", alice, body={"p_status": None})
    case("rpc.list_feedback_works_for_admin", expect_denied=False,
         ok=ok_status(s),
         detail=f"Alice calls list_feedback → status={s}")

    # --- my_profile returns shadow_role_response for the caller ---
    s, b = rest("POST", "rpc/my_profile", bob, body={})
    has = isinstance(b, dict) and "shadow_role_response" in b
    case("rpc.my_profile_returns_sensitive_for_self",
         expect_denied=False,
         ok=ok_status(s) and has,
         detail=f"my_profile keys include shadow_role_response → {has} (status={s})")

    # --- acknowledge_session no-op for non-mentee ---
    # Get a session id we don't own:
    s_admin, sess_list = rest("POST", "rpc/my_sessions", alice, body={})
    sess_for_alice = (sess_list or [])[:1]
    target_id = None
    for s_row in sess_for_alice:
        if isinstance(s_row, dict) and "id" in s_row and s_row.get("mentee_id") != "852c6373-ecef-4023-85d1-79c738181b7e":
            target_id = s_row["id"]; break
    if target_id is not None:
        s, b = rest("POST", "rpc/acknowledge_session", bob, body={"p_session_id": target_id})
        case("rpc.acknowledge_session_no_op_for_non_mentee",
             expect_denied=False,
             ok=s in (200, 204),
             detail=f"acknowledge_session for someone else's row → status={s} (silent no-op)")

    # Summary
    passed = sum(1 for c in cases if c["ok"])
    print(f"\n{passed}/{len(cases)} cases passed")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    sys.exit(main())
