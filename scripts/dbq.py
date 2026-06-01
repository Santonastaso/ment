#!/usr/bin/env python3
"""Run SQL against the live Supabase project via the Management API (HTTPS).

The sandbox blocks raw Postgres ports, so direct psycopg/psql connections fail.
This helper uses https://api.supabase.com/v1/projects/{ref}/database/query with
the personal access token (SUPABASE_PAT) from .env. Use it to test queries and
RPCs in isolation before they land in a migration.

Usage:
  python3 scripts/dbq.py "select 1"          # inline SQL
  python3 scripts/dbq.py -f path/to/file.sql # SQL from a file
  echo "select 1" | python3 scripts/dbq.py - # SQL from stdin
"""
from __future__ import annotations
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
ENV: dict[str, str] = {}
for line in ENV_PATH.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip()

REF = ENV["SUPABASE_PROJECT_REF"]
PAT = ENV["SUPABASE_PAT"]


def run(sql: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {PAT}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "curl/8.4.0")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            txt = resp.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise SystemExit(f"HTTP {e.code}: {body}")


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "-f":
        sql = Path(args[1]).read_text()
    elif args[0] == "-":
        sql = sys.stdin.read()
    else:
        sql = " ".join(args)
    result = run(sql)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
