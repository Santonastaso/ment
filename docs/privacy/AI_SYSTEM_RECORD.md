# AI system record — draft

Status: engineering inventory, 2026-11-06. System owner, business owner, privacy reviewer and model-quality reviewer: **PENDING named assignment**. Legal classification, applicability and any required impact assessment: **PENDING qualified review**. No AI Act or GDPR conformity conclusion is made.

## Intended operation

MENT assists professional mentoring discovery, profile drafting, outreach drafting and private reflection skill classification. Intended workflow: members select connections, review profile/outreach drafts and choose whether to send. Capacity and existing-relationship rules are enforced outside the model. Employment selection, admissions, grading and other consequential automated decisions are outside the documented intended use; actual organizational use must be checked before launch. Ranking can affect visibility even when a human makes the final choice.

| Feature | Inputs actually sent / output | Source |
| --- | --- | --- |
| Discovery clarification and matching | Conversation/request, coverage and lexical hints; eligible candidate facts including skills, role, department, program, location, seniority, tenure and career experience. Candidate aliases and inter-organization redaction reduce exposure; do not assume all prompts are anonymous. Output: suggestions and grounded reasons. | `supabase/functions/discovery-assistant/index.ts`, `docs/discovery-ai-prompts.md` |
| Outreach drafting | Sender need, selected recipient facts and variant; member reviews draft before sending. | `discovery-assistant/index.ts` |
| Voice and place helpers | Recent replies, last user message, generated message or place name. Voice inputs are masked where implemented, but free text can still contain personal data. | `discovery-assistant/index.ts`, `voice.ts`, `places.ts` |
| CV profile draft | Extracted document text, up to 30,000 characters, source kind and language instruction. Original PDF/DOCX is parsed in the Edge runtime; extracted text reaches Mistral. Output: role, department, location, bio, career history and skills. | `supabase/functions/profile-ingest/index.ts` |
| Reflection classification | The member's `support_needed` and `managed_well` free text. Output: concise strengths/gaps; these are persisted automatically, unlike profile/outreach drafts. | `supabase/functions/reflection-classify/index.ts` |

Users can place sensitive or third-party information in free text or CVs even though prompts prohibit sensitive-trait inference. Prompt instructions do not remove this risk. Notice coverage, minimization and authorized source-data use remain review items.

## Configuration and safeguards

`_shared/mistral.ts` calls `https://api.mistral.ai/v1/chat/completions`. Processing requires `AI_PROCESSING_ENABLED=true`, a server-side `MISTRAL_API` or `MISTRAL_API_KEY`, and a model. Feature-specific `MISTRAL_MODEL_*` overrides take precedence. Code defaults for discovery clarify/match/voice and profile ingest are `mistral-small-latest`; other features use `MISTRAL_MODEL`. A configured general model can be a provider fallback when there is no explicit feature override. `.env.example` suggests `ministral-3b-latest`; that is not proof of the production model. Mutable `latest` aliases require recording the resolved provider model where available.

Prompt versions at baseline: `discovery-v25`, `profile-ingest-v4`, `reflection-v2`. Prompts require supplied facts and prohibit diagnosis or sensitive-trait inference; output guards validate shape/grounding. Voice guards can keep the original template when a rewrite fails validation. Provider errors surface as unavailable/error responses rather than fabricated matches. User AI opt-out is checked by the handlers. CV import additionally checks active `ai_profile_import` permission before provider processing; withdrawal cannot retract an already transmitted request.

`_shared/ai-telemetry.ts` stores user/organization IDs, feature, prompt version, model, status, latency and error code in `ai_runs`. It excludes prompt/response content, but is still personal data, not anonymous telemetry. Recording is best effort and must not be treated as a complete audit of every provider call. Some provider failure logging retains diagnostic detail (`_shared/mistral.ts`); restricted log access and retention need verification.

## Validation and change operation

Deterministic `npm test` includes discovery/guard/provider contract tests using synthetic inputs. Browser fixtures test member flows, not a live model. `npm run eval:ai` is opt-in, sends synthetic data to the configured provider and is not run by this work. Before changing models/prompts, record model/override settings without secret values, prompt version and candidate commit; run deterministic tests plus an authorized synthetic live evaluation, review language, grounding, bias, empty results and goal replacement, and retain counts/outcomes. A seven-scenario evaluation is limited quality evidence, not a guarantee of fairness or legal classification.

Pending: current production model/overrides and fallback behavior evidence; provider retention/training controls and region; quality threshold and reviewer; misuse monitoring and appeal process; DPIA screening; final AI notice placement. `voice.ts` instructs conversational rewrites not to mention AI; this is not evidence that sufficient AI transparency appears elsewhere. Verify the visible disclosure and required Terms/Privacy gate separately.

Hosted evaluation status, 2026-11-06: main [run 42201028926](https://github.com/Santonastaso/ment/actions/runs/42201028926) failed early with `Missing staging eval configuration`, before model/provider calls. The user confirms staging has not been set up. No quality result exists from that attempt. A separate synthetic Supabase staging project, approved dummy user and staging deployment/configuration must first be established; exact workflow variables/secret and steps are in [production acceptance](PRODUCTION_ACCEPTANCE.md#hosted-ai-evaluation-staging-setup-blocker). This differs from the local `eval:ai` command; neither deterministic tests nor the configuration failure establish live-model quality.
