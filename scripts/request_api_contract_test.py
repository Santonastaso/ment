#!/usr/bin/env python3
"""API-level contract for request_conversation and saved-search links.

A database test proves what the function does. It does not prove that the API
can still find the function after its signature changed, that a request is
still created through it, or that a signed-in user's own token is refused
where it should be. This script checks all three through the real REST API of
a local Supabase stack.

Nothing here is optional: it makes its own recipients, who are free to take a
request, and a step that cannot run is a failure, never a skip.

It writes data (users, requests, saved searches), so it refuses to run anywhere
but localhost. Run it after scripts/seed_local_rls.py.
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
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if urllib.parse.urlparse(URL).hostname not in ("127.0.0.1", "localhost"):
    raise SystemExit("Refusing to run the request contract test against a non-local Supabase instance")
if not SERVICE:
    raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is required to make recipients who can take a request")

ORGANIZATION = "00000000-0000-0000-0000-000000000001"  # the one scripts/seed_local_rls.py uses
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{': ' + detail if detail else ''}")
    if not ok:
        failures.append(name)
    return ok


def call(method: str, path: str, token: str | None, body=None, key: str = ANON, upsert: bool = False):
    request = urllib.request.Request(f"{URL}{path}", data=json.dumps(body).encode() if body is not None else None, method=method)
    request.add_header("apikey", key)
    request.add_header("Authorization", f"Bearer {token or key}")
    request.add_header("Content-Type", "application/json")
    request.add_header("Prefer", "return=representation" + (",resolution=merge-duplicates" if upsert else ""))
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


def recipient(label: str) -> str:
    """A new member of the student's organisation who is free to take a request."""
    status, user = call("POST", "/auth/v1/admin/users", None, key=SERVICE, body={
        "email": f"contract-{uuid.uuid4().hex[:12]}@ment.local", "password": uuid.uuid4().hex, "email_confirm": True,
        "user_metadata": {"name": label}, "app_metadata": {"organization_id": ORGANIZATION, "admin_scope": "none"}})
    if status not in (200, 201) or not isinstance(user, dict) or not user.get("id"):
        raise SystemExit(f"Could not create {label}: {status} {user}")
    status, rows = call("POST", "/rest/v1/profiles?on_conflict=id", None, key=SERVICE, upsert=True, body={
        "id": user["id"], "name": label, "organization_id": ORGANIZATION, "onboarding_complete": True,
        "mentorship_paused": False, "mentorship_unavailable_until": None,
        "weekly_meeting_limit": 5, "monthly_meeting_limit": 20})
    row = rows[0] if status in (200, 201) and isinstance(rows, list) and rows else {}
    if row.get("mentorship_paused") is not False or row.get("deactivated_at") is not None or row.get("weekly_meeting_limit") != 5:
        raise SystemExit(f"Could not make {label} available for requests: {status} {rows}")
    return user["id"]


def code_of(body) -> str:
    return str(body.get("code", "")) if isinstance(body, dict) else ""


def message_of(body) -> str:
    return str(body.get("message", "")) if isinstance(body, dict) else str(body)


def denied(status: int, body) -> bool:
    return status in (401, 403) or code_of(body) == "42501"


def main() -> int:
    student, student_id = sign_in("MENT_EMP_EMAIL", "MENT_EMP_PASSWORD")
    first, second = recipient("Contract Recipient One"), recipient("Contract Recipient Two")

    def request_args(mentor: str, **extra):
        return {"p_mentor_id": mentor, "p_title": "Contract check", "p_message": "Please help",
                "p_scheduled_at": None, "p_duration_minutes": 60, "p_pre_session_question": "A question",
                "p_topics": [], "p_idempotency_key": str(uuid.uuid4()), "p_follow_up_intent": "one_off", **extra}

    def send(args):
        return call("POST", "/rest/v1/rpc/request_conversation", student, args)

    def created(name: str, status: int, body):
        ok = status == 200 and isinstance(body, dict) and bool(body.get("id"))
        check(name, ok, f"{status} {code_of(body)} {message_of(body)[:80]}" if not ok else f"request {body['id']}")
        return body["id"] if ok else None

    def search(title: str):
        status, body = call("POST", "/rest/v1/discovery_threads", student, {"user_id": student_id, "title": title, "turns": []})
        thread = body[0]["id"] if status == 201 and isinstance(body, list) and body else None
        check(f"owner can create a saved search ({title})", bool(thread), f"{status} {message_of(body)[:80]}")
        return thread

    def link_of(thread: str) -> dict:
        status, body = call("GET", f"/rest/v1/discovery_threads?id=eq.{thread}&select=session_id,archived,selected_person_id", student)
        return body[0] if status == 200 and body else {}

    def request_count() -> int:
        status, body = call("POST", "/rest/v1/rpc/my_sessions", student, {})
        return len(body) if status == 200 and isinstance(body, list) else -1

    # 1. The call every existing client makes: nine arguments, no search. It must create a request.
    old_args = request_args(first)
    old_request = created("old-style call creates a request", *send(old_args))

    # 2. Signed out, the function is not callable at all.
    status, body = call("POST", "/rest/v1/rpc/request_conversation", None, request_args(second))
    check("signed-out call is refused", denied(status, body), f"{status} {code_of(body)} {message_of(body)[:60]}")

    # 3. Saved searches: the owner can create and edit, but never write the link.
    repaired, linked = search("Repair search"), search("Linked search")
    if not (old_request and repaired and linked):
        print("\nA request or a saved search could not be made, so the link checks cannot run: failing.")
        return 1
    status, body = call("PATCH", f"/rest/v1/discovery_threads?id=eq.{repaired}", student, {"archived": True, "turns": [{}]})
    check("owner can edit a saved search", status == 200, f"{status} {message_of(body)[:80]}")
    status, body = call("PATCH", f"/rest/v1/discovery_threads?id=eq.{repaired}", student, {"session_id": old_request})
    check("owner cannot write the link on update", denied(status, body), f"{status} {code_of(body)}")
    status, body = call("POST", "/rest/v1/discovery_threads", student, {"user_id": student_id, "title": "Forged", "session_id": old_request})
    check("owner cannot write the link on insert", denied(status, body), f"{status} {code_of(body)}")
    check("a refused write left no link", link_of(repaired).get("session_id") is None, json.dumps(link_of(repaired)))

    # 4. A search that is not the caller's is refused by name, and nothing is created.
    before = request_count()
    status, body = send(request_args(second, p_thread_id=str(uuid.uuid4())))
    check("an unknown search is refused", "thread_not_found" in message_of(body), f"{status} {message_of(body)[:80]}")
    check("the refused call created nothing", before >= 1 and request_count() == before, f"{before} -> {request_count()}")

    # 5. The new call: a request sent from a search is created and linked in the same call.
    new_args = request_args(second, p_thread_id=linked)
    new_request = created("new-style call creates a request", *send(new_args))
    if not new_request:
        print("\nThe new-style request could not be made, so its link cannot be checked: failing.")
        return 1
    row = link_of(linked)
    check("the search carries the link as soon as the call returns",
          row.get("session_id") == new_request and row.get("archived") is True and row.get("selected_person_id") == second, json.dumps(row))

    # 6. Replaying it returns the same request and leaves the link alone.
    before = request_count()
    status, body = send(new_args)
    check("replay returns the same request", status == 200 and isinstance(body, dict) and body.get("id") == new_request, f"{status} {message_of(body)[:80]}")
    check("replay created nothing and kept the link", request_count() == before and link_of(linked).get("session_id") == new_request, json.dumps(link_of(linked)))

    # 7. A request saved without its link (an older client) gets it when replayed with the search.
    status, body = send({**old_args, "p_thread_id": repaired})
    check("replaying an old request with a search returns it", status == 200 and isinstance(body, dict) and body.get("id") == old_request, f"{status} {message_of(body)[:80]}")
    check("and repairs the missing link", link_of(repaired).get("session_id") == old_request, json.dumps(link_of(repaired)))

    # 8. A linked search refuses a different request, new or replayed, and keeps its link.
    before = request_count()
    status, body = send(request_args(first, p_thread_id=linked))
    check("a linked search refuses a new request", "thread_already_linked" in message_of(body), f"{status} {message_of(body)[:80]}")
    status, body = send({**old_args, "p_thread_id": linked})
    check("a linked search refuses another request's replay", "thread_already_linked" in message_of(body), f"{status} {message_of(body)[:80]}")
    check("the refusals changed nothing", request_count() == before and link_of(linked).get("session_id") == new_request, json.dumps(link_of(linked)))

    print(f"\n{len(failures)} failed" if failures else "\nAll request contract checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
