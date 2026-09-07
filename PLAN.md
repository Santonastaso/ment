# PM feedback completion plan

Source: Feedback_After_Form_MVP (2).pdf, pages 1-9; page 10 has no extracted text.
Reviewed against local main at 6719747 on 2026-09-07.
This supersedes the older wave plan, including its contradictory Explorer entry prompt.

## Scope and delivery rules

- Address every PM request below. A component or table existing does not mean the requirement is complete.
- Use deterministic, hardcoded demo responses for every LLM-dependent experience. No paid model or embedding requests in demo mode.
- Keep real authentication, authorization, saved user data, request confirmation, and reporting behavior.
- Clearly identify simulated recommendations/drafts. Keep synthetic interactions out of real KPI totals.
- Database work is authorized. Remote application is currently blocked: the supplied Supabase management token returned HTTP 401 and the installed CLI has no saved login. No new migration was applied during this planning pass.
- No additional product decisions are needed to start: the defaults and definitions below are the implementation contract.

## Priority and sequence

1. Database foundation and accurate reporting: design migrations, validate against a fresh local database, apply to the existing project, verify migration history and access boundaries.
2. Home demo conversation, recurring relationships, review/send, and request limits.
3. Directory-first Explorer and Profile consolidation.
4. School admin reporting, Privacy, audit history, feedback operations, and Knowledge Graph.
5. Full language coverage, visual polish, and browser acceptance tests across roles.

Frontend demo and Profile/Explorer work can proceed while database credentials are unavailable. Persistence-dependent features remain explicitly incomplete until the migration and integrations pass.

## Requirement matrix

| ID / PDF | Requirement and current gap | Implementation | Acceptance |
| --- | --- | --- | --- |
| H1 / p1 | Home conversational interface. Current Home is a single keyword search field. | Replace with a conversation transcript, composer, deterministic clarification turns, and contextual result rows. Retain greeting and useful session counters. | User describes a need, answers a clarification, gets relevant demo suggestions and an explanation. No static matches on first visit. |
| H2 / p1 | Switch from Home to manual browsing. | Add a visible Browse directory action linking directly to Explorer, preserving relevant filters. | One click opens the full directory with no intermediate persona question. |
| H3 / p2 | Recurring relationship continuity. Current search state disappears on reload. | Persist private Home threads and turns. Provide Continue conversation, New search, archive, and recent relationships linked to actual sessions. Support one-off and ongoing intent. | Refresh/sign back in restores the thread. Continuing an existing relationship does not start another match search. Another user cannot read the thread. |
| H4 / p2-3 | Mandatory draft review. Review exists, but the Home question is not carried into the request automatically. | Carry intent, chosen person, question and proposed time into a short deterministic draft. Show recipient and complete outgoing content; allow edits and back navigation; submit only on Confirm and send. | No delivery or session creation before confirmation; double click creates one request; edited content is the content saved/sent. |
| H5 / p3 | Protect alumni from request fatigue. Availability and duplicate handling alone are insufficient. | School-configurable rolling request limits, active pending-request limit, and per-pair cooldown enforced in the database. Respect pause and absence periods. Initial demo defaults: five new incoming requests per alumnus per seven days, three pending, seven-day pair cooldown; school admin can change them. | Concurrent requests cannot bypass the limit. Denial explains when to try again and suggests available alternatives. UI cannot bypass server checks. Defaults remain labelled as product choices, not PM-prescribed numbers. |
| H6 / p3 | Resolve structured versus semantic search. | Demo uses intent fixtures and curated topic synonyms over eligible directory people. State the approach in matching documentation. Put the adapter behind an interface that can later call a model. Do not add embeddings for this demo. | Known paraphrases map to the intended scenario; unknown needs ask a clarification. Never invent qualifications or claim live semantic/LLM processing. |
| E1 / p4-5 | Explorer must open directly on the directory. It currently defaults to Find and Top matches. | Make Explorer directory-only; put assisted discovery on Home. Remove Find/Directory entry choices and Top matches from Explorer. Keep search, persona/program/cohort/location/language filters, pagination and URL state. | Opening Explorer immediately shows browsable profiles. No ranking percentages, top-three screen, or student/alumni clickthrough. |
| E2 / p4-5 | Efficient manual browsing. | Preserve text query across filters, reset page on filter changes, provide clear filters and useful loading/error/empty states. | Combined filters and pagination work; back/forward restore state; failed requests do not masquerade as zero results. |
| P1 / p6 | Strengths, growing skills and quick reflection visible together. Sections exist but remain a tall stack. | Compact two-column skills summary plus adjacent quick reflection on desktop; concise stacked layout on mobile; expand long lists. | At 1440x900, the beginning of both skill lists and reflection entry action are visible without scrolling. All entries remain accessible. |
| P2 / p6 | Remove deficit/quota framing. X/Y summary is gone but growing skills still say Missing. | Replace Missing with neutral curiosity wording; remove completion quotas from skill overview and detail popups. Keep plain counts and optional factual session history. | New users see interests and strengths without unfinished-goal messaging. |
| P3 / p6-7 | Recognizable skill entry and stronger headers. Autocomplete exists, but fields remain borderless; growing-skills placeholder becomes blank after the first entry. | Use visibly bordered, labelled inputs with persistent prompts and Add action; strengthen Teach/Learn headings. Preserve ESCO autocomplete and custom entries. | Mouse and keyboard users can add suggested/custom skills; the field stays obvious after adding several skills. |
| P4 / p7-8 | Clear skill evidence interaction. Help and 80-character cap exist, but arrow rows do not explain their purpose or show the evidence. | Label the action Give one concrete example; show a short existing-example preview; explicit draft and Save/Cancel; instruction asking for one sentence, ideally with a number. Enforce 80 characters on writes. | Evidence is discoverable, editable, cancellable, and stays saved after refresh. No request per keystroke or stale-response overwrite. Existing longer evidence is preserved for review rather than silently truncated. |
| P5 / p8 | Remove corrupt text in Skills, Availability, Experience and Meetings. Previous scan missed malformed checkmark-plus-quote text. | Audit rendered copy and catalogs, including residual malformed symbols and literal strings. | Clean screenshots for all four tabs and reflections, in EN/IT/FR; checks cover known corruption patterns and encoding round trips. |
| P6 / p8 | Quick reflection on Overview, history in Reflections. Placement exists. | Finish compact entry state, draft preservation, deterministic demo extraction, suggestion review, and saved history. | Overview can submit a reflection; suggestions apply once; history persists in Reflections; cancelling does not apply skills. |
| A1 / p9 | School admin has no Home, Explorer or My profile; separate master admin. Route/sidebar restrictions largely exist. | Keep school administration organization-scoped. Verify direct URLs, top-bar search, user menu and backend access. Name platform-only area Platform administration with a clear description. | Alice sees only school tools. Bob cannot access admin. School admin cannot access platform operations or another school. |
| G1 / p9 | Remove intra/inter toggle; meaningful graph filters; improve Obsidian-like presentation. Toggle removal and three filters exist. | Retain school scope; add persona/cohort/skill filtering and reset. Filter orphan skill nodes and counts. Add search/focus, fit/reset zoom, restrained labels and colors, node detail panel, explicit empty/error states and accessible list fallback. | Filtering shows only relevant nodes/links, counters agree, dense graphs remain usable, and school admins cannot switch schools. |
| K1 / p9 | Ten reliable PM metrics. Current cards contain proxies and missing instrumentation. | Use the data contracts and formulas below; show numerator, denominator, period and No data where appropriate. Add definition tooltips and export. | Seeded fixtures produce independently calculated expected values. No private reflection text is mined for intent. No missing metric becomes a fabricated zero. |
| A2 / p9 | Simplify Privacy. Toggle removed, but intra/inter terminology and technical infrastructure details remain. | Show who can see what, consent/data handling, school controls and aggregate reporting threshold. Keep infrastructure details in platform tools. | School Privacy screen contains no company-mode controls or unexplained edge-function/region details. |
| A3 / p9 | Explain audit log and fix invalid dates. AuditRow appends Z unconditionally. | Normalize timestamps without double timezone suffix; render invalid/missing values safely; explain actor/action/time and add filtering. Load data on direct tab navigation, not only click handlers. | Offset, UTC, missing and invalid dates render correctly; refresh/deep link works for audit, KPI and people tabs. |
| A4 / p9 | Feedback destination/email. In-app queue exists; no complete mailbox workflow. | Document in-app queue as source of truth. Configure a support recipient and delivery outbox, status/retries and deduplication; demo delivery preview when email is unconfigured. | Feedback appears in the correct school queue and can be triaged. Demo says delivery is simulated. Real email requires an actual mailbox and verified sender; creating a mailbox is external provider setup. |
| Q1 / cross-cutting | UI still generic; incomplete French; insufficient regression coverage. | Consolidate shared controls and surfaces, complete FR and mixed hardcoded strings, audit focus/labels/contrast/mobile layouts, implement the browser checks below. | Desktop/mobile screenshots and interaction evidence exist for user, school admin and platform admin, with no uncaught errors. |

## Database work packages

These are implementation specifications, not claims of deployed schema. Author changes as separate forward migrations after 0029; inspect remote history first and never replay/rewrite already applied migrations.

### DB1: Conversation and relationship persistence

- Private discovery_threads and discovery_turns keyed by user, with intent (one_off/ongoing), selected person references, archive state, sequence and timestamps.
- Preserve transcript state and chosen candidates; do not persist invented profile details as real user attributes.
- Stable relationship identity for each unordered pair within an organization; link existing connections and sessions rather than creating duplicate pair records.
- Explicit mentorship proposal/acceptance timestamps; one participant proposes and the counterpart confirms.
- Real relationship replies use a separate message/event store from the demo assistant transcript. Assistant turns never count as human replies.
- Session request idempotency key; accepted_at and completed_at event timestamps retained even if status later changes.
- Private thread RLS, participant-only relationship access, same-school eligibility, active-user checks, indexed owner/pair/event lookups.

### DB2: Accurate measurement

- Outreach cohorts/targets with stable recipient identity, student/alumnus category, invited/targeted date, organization and optional linked profile. Include people who never signed up.
- Record completed profile activation date; do not backdate imported accounts as completed invitations without evidence.
- Explicit meeting occurrence, career conversation and referral outcome records with participant/session linkage and idempotent event identity.
- Explicit mentorship mutual confirmation rather than counting repeat meetings as mentorships.
- Per-user, per-term intent survey with yes/no/unsure and response timestamp; reporting aggregates only.
- Distinguish demo versus real events at the storage boundary; demo events excluded by default.
- Replace _admin_kpis proxy formulas; preserve API keys used by the client while adding denominators/availability metadata.
- Backfill only verifiable completed meetings and accepted events. Mark historical unknowns as unknown.

### DB3: Alumni load protection

- Organization-level limits plus recipient preference overrides within allowed school limits.
- Enforce caps in request_session under a recipient lock so concurrent submissions serialize; keep pause/absence checks.
- Store accepted/rejected attempts without private draft content; prevent retries from consuming additional quota.
- Validate cooldown and rolling-window boundaries with controlled timestamps.
- Expose remaining capacity/next eligible time through scoped RPC responses for the client.

### DB4: Evidence, feedback and audit

- Enforce 80-character evidence on new/edited values; inventory legacy violations before enabling a validated constraint.
- Feedback delivery outbox references existing feedback_messages, with destination configuration, retry count, state and idempotency key.
- Reuse audit_logs; validate timestamp contracts and actor/organization scoping rather than inventing a parallel audit table.
- Apply explicit grants, RLS, RPC authorization and fixed search paths for new exposed objects.
- Verify anonymous denial, user isolation, organization isolation and platform-only access with actual role tests.
- Apply migrations transactionally where supported, then verify objects, migration history and existing request/profile flows.

## KPI definitions

Reporting must display the selected cohort/term and as-of date. Acceptance/reply use the same request cohort, avoiding mismatched numerator and denominator periods.

| PM metric | Definition / required evidence |
| --- | --- |
| Student activation | Unique invited students who signed up and completed a profile / unique students invited in selected cohort. |
| Alumni activation | Unique targeted alumni who signed up and completed a profile / unique alumni targeted in selected cohort. |
| Alumni engagement | Activated alumni with a real human reply, recorded completed meeting or confirmed mentoring activity / activated alumni in selected cohort. Acceptance alone is not engagement. |
| Meaningful connections | Distinct unordered pairs with messages from both humans or a completed/logged meeting. Scheduled meetings and accepted requests alone do not qualify. |
| Connection coverage | Activated students with at least one meaningful connection / activated students. Derive from the same pair definition above. |
| Acceptance rate | Requests with a recorded acceptance / requests sent in selected cohort. Preserve historical acceptance when a later cancellation occurs; deduplicate retries. |
| Reply rate | Accepted connections with at least one real human reply after acceptance / accepted connections. Exclude assistant drafts, automated notifications and the initial request. |
| Mentorships formed | Distinct relationships explicitly confirmed as mentorships by both participants. |
| Career conversations / referrals | Separate counts of explicitly logged completed career chats and referral events, with session/event deduplication. Never reuse the meaningful-pairs total. |
| Intent to continue | Yes responses / all valid yes/no/unsure responses to an explicit next-term question. Display response count and response rate; no responses means No data. |

## LLM demo contract

Implement one demo adapter shared by Home, message drafting, profile ingestion and reflection classification. The request is to hardcode LLM behavior, not to run Anthropic silently when a key happens to exist.

- Scenarios: internship search, career switch, technical help, ongoing alumni mentorship, insufficient detail, no eligible person.
- Fixed multilingual conversation turns and curated synonym mapping; stable ordering for repeatable QA.
- Resolve suggestions through permitted current profiles or clearly separated demo fixtures. Respect role, school, availability and request limits.
- Use deterministic concise matching reasons backed by displayed attributes.
- Editable short introduction draft carries the user's actual question; do not invent credentials or relationships.
- Ongoing scenario resumes an existing selected relationship after reload.
- Profile ingestion offers a labelled sample extraction to review; do not claim arbitrary uploaded documents were actually interpreted by the demo.
- Reflection demo offers fixed skill suggestions for supported scenarios and a neutral fallback. Applying remains an explicit user action.
- No network calls to model providers; visible demo label; predictable simulated failure/retry scenario.
- Keep adapter inputs/outputs small and documented so a future real provider can replace it without rewriting screens.

## Browser acceptance suite

Use isolated test data and user, school-admin and platform-admin accounts. Restore or delete only records created by the tests.

1. Home: new ask, clarification, three suggestions, no result, continue relationship, refresh and sign-in persistence.
2. Request: edit preview, back/cancel, confirm once, double-click/retry, capacity rejection, unavailable alumnus.
3. Explorer: direct entry, text plus combined filters, clear filters, page navigation, back/forward, profile open.
4. Profile: Overview visibility; add suggested/custom skill; evidence save/cancel/limit; availability; career; completed meetings; quick reflection and history.
5. Admin: all tabs including direct URLs, export, KPI expected values, privacy, audit dates, feedback triage, role boundaries.
6. Graph: filters, orphan cleanup, node focus, fit/reset, dense and empty data, keyboard/list fallback.
7. Locales: EN/IT/FR rendered text and controls; no English placeholders in French flows.
8. Viewports: 1440x900, 1280x800 and 390x844; modal scrolling, keyboard focus, no horizontal clipping.
9. Diagnostics: captured console errors and failed requests; distinguish expected validation responses from faults.
10. Demo isolation: zero model-provider requests; simulated conversations/delivery never affect live engagement metrics.

## Completion evidence

For every matrix ID, record: implemented files/migration, automated or browser evidence, and status (pending / implemented / verified / blocked). A green key-coverage script is not translation QA; an existing KPI card is not valid measurement; a screenshot is not proof that saving works.

At the end, deliver the requirement checklist, migration results, screenshots and test results. Remaining external dependencies must name the exact service failure rather than be labelled completed.

## Current blockers and next action

- Supabase project vqvjdtnpcamyrqkqsrfb: supplied management credential returns 401 Unauthorized; CLI has no stored login. A working Supabase login/token is required for remote inspection/application.
- Feedback email: actual support mailbox and verified sender configuration are not established by creating database tables. Build queue and demo preview; report real delivery separately.
- This turn produces the plan. It does not claim the frontend, demo adapters or database work above has been implemented.
