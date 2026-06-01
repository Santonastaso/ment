#!/usr/bin/env python3
"""One-time backfill (F9): rewrite career_history descriptions written in third
person into first person, e.g. "Ships features across the web app." ->
"I ship features across the web app.".

Mirrors firstPersonize() in client/src/lib/utils.js exactly so existing rows and
newly-saved rows are normalized the same way. Conservative: only fires on a
curated verb allowlist, leaving noun phrases and past-tense bullets untouched.

Usage:
  python3 scripts/backfill_career_first_person.py --dry-run
  python3 scripts/backfill_career_first_person.py --apply
"""
from __future__ import annotations
import re
import sys
import json

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from dbq import run  # noqa: E402

THIRD_PERSON_VERBS = {
    'ships', 'builds', 'leads', 'owns', 'runs', 'manages', 'coordinates',
    'designs', 'supports', 'drives', 'maintains', 'develops', 'oversees',
    'handles', 'delivers', 'creates', 'analyzes', 'analyses', 'writes',
    'organizes', 'organises', 'plans', 'directs', 'operates', 'implements',
    'produces', 'reports', 'researches', 'reviews', 'mentors', 'coaches',
    'guides', 'scales', 'optimizes', 'optimises', 'serves',
}


def base_verb(lower: str) -> str:
    if re.search(r'(ches|shes|sses|xes)$', lower):
        return lower[:-2]
    if lower.endswith('ies'):
        return lower[:-3] + 'y'
    if lower.endswith('s'):
        return lower[:-1]
    return lower


def fix_coordinated(s: str) -> str:
    def repl(mo):
        conj, verb = mo.group(1), mo.group(2)
        return conj + base_verb(verb.lower()) if verb.lower() in THIRD_PERSON_VERBS else mo.group(0)
    return re.sub(r'(\band\s+)([A-Za-z]+)', repl, s)


def first_personize(text: str) -> str:
    s = (text or '').strip()
    if not s:
        return text or ''
    if re.match(r'^I\b', s):
        return fix_coordinated(s)
    m = re.match(r'^([A-Za-z]+)([\s\S]*)$', s)
    if not m:
        return s
    first = m.group(1)
    if first.lower() not in THIRD_PERSON_VERBS:
        return s
    return 'I ' + base_verb(first.lower()) + fix_coordinated(m.group(2))


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else '--dry-run'
    rows = run("select id, description from public.career_history where coalesce(description,'') <> '';")
    changes = []
    for r in rows:
        new = first_personize(r['description'])
        if new != r['description']:
            changes.append((r['id'], r['description'], new))

    for cid, before, after in changes:
        print(f"#{cid}\n  - {before}\n  + {after}")
    print(f"\n{len(changes)} of {len(rows)} rows would change.")

    if mode == '--apply' and changes:
        # Single statement with a VALUES list keyed by id.
        values = ", ".join(f"({cid}, {sql_quote(after)})" for cid, _, after in changes)
        run(
            f"update public.career_history c set description = v.d "
            f"from (values {values}) as v(id, d) where c.id = v.id;"
        )
        print(f"Applied {len(changes)} updates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
