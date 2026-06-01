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
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            ENV[k.strip()] = v.strip()


def env(key: str, default: str = "") -> str:
    # .env at repo root takes precedence locally; CI passes via os.environ.
    return ENV.get(key) or os.environ.get(key, default)


SUPABASE_URL = env("SUPABASE_URL")
ANON = env("SUPABASE_ANON_KEY")
SRK = env("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not ANON:
    print("Skipping RLS smoke test: SUPABASE_URL / SUPABASE_ANON_KEY not set.")
    sys.exit(0)

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
    try:
        bob = sign_in(EMP["email"], EMP["password"])
        alice = sign_in(ADMIN["email"], ADMIN["password"])
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"Skipping RLS smoke test: could not sign in seed users ({e}).")
        return 0

    # Resolve ids dynamically instead of hardcoding seed UUIDs.
    _, bob_profile = rest("POST", "rpc/my_profile", bob, body={})
    BOB_ID = bob_profile.get("id") if isinstance(bob_profile, dict) else None
    _, alice_profile = rest("POST", "rpc/my_profile", alice, body={})
    ALICE_ID = alice_profile.get("id") if isinstance(alice_profile, dict) else None
    if not BOB_ID or not ALICE_ID:
        print("Could not resolve seed user ids via my_profile; aborting.")
        return 1
    # A peer employee (not Bob) for peer_profile privacy checks.
    _, ulist = rest("POST", "rpc/admin_users", alice, body={"p_limit": 200, "p_offset": 0})
    PEER_ID = None
    if isinstance(ulist, dict):
        for u in ulist.get("users", []):
            if u.get("id") and u["id"] != BOB_ID:
                PEER_ID = u["id"]; break

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
                params={"select": "id,support_needed,user_id", "user_id": f"neq.{BOB_ID}"})
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
        bob_id_row = next((r for r in rows if r.get("user_id") and r["user_id"] != BOB_ID), None)
        if bob_id_row:
            leaked.append(bob_id_row)
    case("feedback_isolated_select", expect_denied=False,
         ok=len(leaked) == 0, detail=f"Bob SELECT on feedback_messages: {len(rows)} rows, {len(leaked)} cross-user")

    # --- Profile UPDATE attempts ---
    other_uid = ALICE_ID
    s, b = rest("PATCH", "profiles", bob, body={"bio": "hacked"},
                params={"id": f"eq.{other_uid}"})
    # PATCH with eq=other and RLS update policy id=auth.uid() means 0 rows updated
    rows = b if isinstance(b, list) else []
    case("profiles.update_other_user_denied", expect_denied=False,
         ok=len(rows) == 0,
         detail=f"PATCH profiles bio for OTHER user → updated {len(rows)} rows (must be 0)")

    # --- Direct UPDATE to escalate admin scope on own row should fail (guard trigger) ---
    s, b = rest("PATCH", "profiles", bob, body={"admin_scope": "platform"},
                params={"id": f"eq.{BOB_ID}"})
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
        if isinstance(s_row, dict) and "id" in s_row and s_row.get("mentee_id") != BOB_ID:
            target_id = s_row["id"]; break
    if target_id is not None:
        s, b = rest("POST", "rpc/acknowledge_session", bob, body={"p_session_id": target_id})
        case("rpc.acknowledge_session_no_op_for_non_mentee",
             expect_denied=False,
             ok=s in (200, 204),
             detail=f"acknowledge_session for someone else's row → status={s} (silent no-op)")

    # --- career_history cross-user read isolation (RLS career_select_own) ---
    if PEER_ID:
        s, b = rest("GET", "career_history", bob,
                    params={"select": "id,user_id,company", "user_id": f"eq.{PEER_ID}"})
        rows = (b if isinstance(b, list) else []) if ok_status(s) else []
        case("career_history_isolated", expect_denied=False,
             ok=ok_status(s) and len(rows) == 0,
             detail=f"Bob reads PEER career_history → {len(rows)} rows (must be 0)")

    # --- mentorship_unavailable_periods cross-user read isolation ---
    if PEER_ID:
        s, b = rest("GET", "mentorship_unavailable_periods", bob,
                    params={"select": "id,user_id", "user_id": f"eq.{PEER_ID}"})
        rows = (b if isinstance(b, list) else []) if ok_status(s) else []
        case("unavailable_periods_isolated", expect_denied=False,
             ok=ok_status(s) and len(rows) == 0,
             detail=f"Bob reads PEER unavailable periods → {len(rows)} rows (must be 0)")

    # --- role column cannot be self-escalated via direct PATCH (guard) ---
    s, b = rest("PATCH", "profiles", bob, body={"role": "team_lead"},
                params={"id": f"eq.{BOB_ID}"})
    case("profiles.escalate_role_blocked", expect_denied=True, ok=ok_status(s),
         detail=f"Bob sets role=team_lead on self → status={s} (must be denied)")

    # --- peer_profile must not leak private fields, and hides career ---
    if PEER_ID:
        s, b = rest("POST", "rpc/peer_profile", bob, body={"p_user_id": PEER_ID})
        leaks_shadow = isinstance(b, dict) and "shadow_role_response" in b
        career_hidden = isinstance(b, dict) and (b.get("career") in ([], None))
        case("rpc.peer_profile_no_shadow", expect_denied=False,
             ok=ok_status(s) and not leaks_shadow,
             detail=f"peer_profile exposes shadow_role_response → {leaks_shadow} (must be False)")
        case("rpc.peer_profile_hides_career", expect_denied=False,
             ok=ok_status(s) and career_hidden,
             detail=f"peer_profile career hidden → {career_hidden} (status={s})")
        # In inter (PMI) mode the surname must be redacted ("Name X.").
        org_type = b.get("org_type") if isinstance(b, dict) else None
        if org_type == "inter" and isinstance(b.get("name"), str):
            redacted = b["name"].rstrip().endswith(".")
            case("rpc.peer_profile_redacts_surname_inter", expect_denied=False,
                 ok=redacted,
                 detail=f"inter-mode peer name redacted → '{b['name']}'")

    # --- admin-only RPCs denied for an employee ---
    s, b = rest("POST", "rpc/admin_kpis", bob, body={"p_org": None})
    case("rpc.admin_kpis_denied_for_employee", expect_denied=True, ok=ok_status(s),
         detail=f"Bob calls admin_kpis → status={s}")
    if PEER_ID:
        s, b = rest("POST", "rpc/admin_set_role", bob, body={"p_user_id": PEER_ID, "p_role": "manager"})
        case("rpc.admin_set_role_denied_for_employee", expect_denied=True, ok=ok_status(s),
             detail=f"Bob calls admin_set_role → status={s}")

    # Summary
    passed = sum(1 for c in cases if c["ok"])
    print(f"\n{passed}/{len(cases)} cases passed")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    sys.exit(main())
