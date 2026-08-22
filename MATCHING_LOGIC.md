# How matching works — one-pager

_Audience: PM / stakeholders. Code refs: `_recompute_matches_for` (0018), `get_matches_for` (0013/0015), debounce (0025)._

## TL;DR

- Matching is **pure SQL** — zero API/LLM tokens, ever.
- Each pair gets a **base score (0–85)** from three signals; only pairs ≥ 30 are stored as matches.
- At read time, your own history nudges scores up/down (±~19 max) and filters people out.
- Scores refresh automatically within ~5 minutes of any profile change; no spinners, no cost.

## Base score (stored per pair)

| Signal | Max | Rule |
|---|---|---|
| Skill overlap | **40** | 10 pts per distinct skill where one person *can teach* what the other *wants to learn* (both directions counted), capped at 40 |
| Career crossover | **20** | +20 if either person has past work history in the other's current department ("career bridge") |
| Department diversity | **25** | +25 when the two departments differ — cross-department pairing is a feature |

**Storage threshold: ≥ 30.** Below that, the pair is not a match (but can still appear in Explorer via directory affinity, see below).

Max possible base = 85.

## Read-time layer (`get_matches_for`) — personalized, not stored

Applied every time you view suggestions; uses **your** history with the candidate's **department**:

| Adjustment | Value | Condition |
|---|---|---|
| Rating bonus | +5 / +3 / +1 | You've rated ≥ 2 completed sessions with this department; avg rating ≥ 4.5 / ≥ 4.0 / ≥ 3.5 |
| Rating penalty | −5 / −3 | Same but avg < 2.5 / < 3.0 |
| Department boost | +2 per past session, max +6 | You've mentored/been mentored by this department before |
| Decline penalty | −1 per decline, max −8 | You've declined people from this department |

Final score = clamp(base + adjustments, 0, 100).

Also at read time: declined people disappear, anyone with an active request/session with you disappears, and "mentor" suggestions require the person to be currently available (pause/unavailable periods respected).

## Freshness (debounced recompute, added 0025)

Writes used to recompute synchronously; now they just set a cheap `matches_stale` flag:

- A scheduled job processes flagged users in small batches **every 5 minutes** — changes are live well under the next coffee refill.
- Full rebuild nightly (03:15 UTC).
- Session completion still updates both people **immediately** (it's the strongest signal anyway).
- Admin "Re-run matching" rebuilds **your organization only**, user-by-user with error isolation — the previous global O(N²) single request was the source of the timeout error.
- CSV imports flag and process just the imported users synchronously.

## Cost

Zero. No embeddings, no LLM calls, no external APIs — everything above runs inside Postgres. The only AI feature in the product (reflection keyword classification) is off by default and unrelated to matching.
