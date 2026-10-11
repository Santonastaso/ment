#!/usr/bin/env python3
"""API-level contract for request_conversation and saved-search links.

A database test proves what the function does. It does not prove that the API
can still find the function after its signature changed, or that a signed-in
user's own token is refused where it should be. This script checks both
through the real REST API of a local Supabase stack.

It writes data (a request, saved searches), so it refuses to run anywhere but
localhost. Run it after scripts/seed_local_rls.py.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
if urllib.parse.urlparse(URL).hostname not in ("127.0.0.1", "localhost"):
    raise SystemExit("Refusing to run the request contract test against a non-local Supabase instance")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{': ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def call(method: str, path: str, token: str | None, body=None):
    request = urllib.request.Request(f"{URL}{path}", data=json.dumps(body).encode() if body is not None else None, method=method)
    request.add_header("apikey", ANON)
    request.add_header("Authorization", f"Bearer {token or ANON}")
    request.add_header("Content-Type", "application/json")
    request.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text)
        except Exception:
            return error.code, text


def sign_in(email_key: str, password_key: str) -> tuple[str, str]:
    status, body = call("POST", "/auth/v1/token?grant_type=password", None,
                        {"email": os.environ[email_key], "password": os.environ[password_key]})
    if status != 200:
        raise SystemExit(f"Could not sign in {email_key}: {status} {body}")
    return body["access_token"], body["user"]["id"]


def code_of(body) -> str:
    return str(body.get("code", "")) if isinstance(body, dict) else ""


def message_of(body) -> str:
    return str(body.get("message", "")) if isinstance(body, dict) else str(body)


def resolved(status: int, body) -> bool:
    """The API found exactly one function for these arguments and ran it."""
    return code_of(body) not in ("PGRST202", "PGRST203") and status != 404


def denied(status: int, body) -> bool:
    return status in (401, 403) or code_of(body) == "42501"


def main() -> int:
    student, student_id = sign_in("MENT_EMP_EMAIL", "MENT_EMP_PASSWORD")
    _, mentor_id = sign_in("MENT_PEER_EMAIL", "MENT_PEER_PASSWORD")

    def request_args(**extra):
        return {"p_mentor_id": mentor_id, "p_title": "Contract check", "p_message": "Please help",
                "p_scheduled_at": None, "p_duration_minutes": 60, "p_pre_session_question": "A question",
                "p_topics": [], "p_idempotency_key": str(uuid.uuid4()), "p_follow_up_intent": "one_off", **extra}

    # 1. The call every existing client makes: nine arguments, no search.
    old_args = request_args()
    status, body = call("POST", "/rest/v1/rpc/request_conversation", student, old_args)
    check("old-style call resolves to the function", resolved(status, body), f"{status} {code_of(body)} {message_of(body)[:80]}")
    created = status == 200 and isinstance(body, dict) and body.get("id")
    # Whether the seeded pair may actually open a request is a business rule
    # (availability, limits), not part of this contract; a refusal by rule
    # still proves the call reached the function. Say which happened.
    refused_by_rule = status == 400 and code_of(body) == "P0001"
    check("old-style call runs the function", bool(created) or refused_by_rule, f"{status} {message_of(body)[:80]}")
    print(f"[INFO] request {'created' if created else 'refused by rule: ' + message_of(body)[:60]}; link checks {'run' if created else 'are skipped'}")

    # 2. Signed out, the function is not callable at all.
    status, body = call("POST", "/rest/v1/rpc/request_conversation", None, request_args())
    check("signed-out call is refused", denied(status, body) or "auth" in message_of(body).lower() or "not_allowed" in message_of(body),
          f"{status} {code_of(body)} {message_of(body)[:60]}")

    # 3. Saved searches: the owner can create and edit, but never write the link.
    status, body = call("POST", "/rest/v1/discovery_threads", student, {"user_id": student_id, "title": "Contract search", "turns": []})
    thread_id = body[0]["id"] if status == 201 and isinstance(body, list) and body else None
    check("owner can create a saved search", bool(thread_id), f"{status} {message_of(body)[:80]}")
    if thread_id:
        status, body = call("PATCH", f"/rest/v1/discovery_threads?id=eq.{thread_id}", student, {"archived": True, "turns": [{}]})
        check("owner can edit a saved search", status == 200, f"{status} {message_of(body)[:80]}")
        status, body = call("PATCH", f"/rest/v1/discovery_threads?id=eq.{thread_id}", student, {"session_id": created or 1})
        check("owner cannot write the link on update", denied(status, body), f"{status} {code_of(body)}")
    status, body = call("POST", "/rest/v1/discovery_threads", student,
                        {"user_id": student_id, "title": "Forged", "session_id": created or 1})
    check("owner cannot write the link on insert", denied(status, body), f"{status} {code_of(body)}")

    # 4. The new call: the argument reaches the function, and a search that is
    #    not the caller's is refused by name.
    status, body = call("POST", "/rest/v1/rpc/request_conversation", student, request_args(p_thread_id=str(uuid.uuid4())))
    check("new-style call resolves to the function", resolved(status, body), f"{status} {code_of(body)}")
    check("an unknown search is refused", "thread_not_found" in message_of(body), f"{status} {message_of(body)[:80]}")

    # 5. Replaying the first request with the search links them, in one call.
    if thread_id and created:
        status, body = call("POST", "/rest/v1/rpc/request_conversation", student, {**old_args, "p_thread_id": thread_id})
        check("replay with a search returns the same request", status == 200 and isinstance(body, dict) and body.get("id") == created,
              f"{status} {message_of(body)[:80]}")
        status, body = call("GET", f"/rest/v1/discovery_threads?id=eq.{thread_id}&select=session_id,archived", student)
        row = body[0] if status == 200 and body else {}
        check("the search now carries the link", row.get("session_id") == created and row.get("archived") is True, json.dumps(row))
        status, body = call("POST", "/rest/v1/rpc/request_conversation", student, request_args(p_thread_id=thread_id))
        check("a linked search refuses a different request", "thread_already_linked" in message_of(body), f"{status} {message_of(body)[:80]}")

    print(f"\n{len(failures)} failed" if failures else "\nAll request contract checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
