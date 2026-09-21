// Profile ingest (Deno port of server/routes/profile-ingest.js + profileExtractor.js).
// Body: { storage_path: string, kind?: 'performance_review' | 'cv' | 'manual_text' }
// Returns: { draft_id, proposed, classifier_source }

import mammoth from 'npm:mammoth@1.9.0';
// pdfjs-dist is the Deno-friendly PDF parser. Using legacy build to avoid worker setup.
import { getDocument } from 'npm:pdfjs-dist@4.7.76/legacy/build/pdf.mjs';
import {
  corsHeaders,
  jsonError,
  jsonOk,
  requireUser,
} from '../_shared/index.ts';
import { recordAiRun } from '../_shared/ai-telemetry.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';
import { normalizeLang } from '../_shared/esco.ts';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French' };
const PROMPT_VERSION = 'profile-ingest-v2';

async function extractText(buf: Uint8Array, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    // pdfjs accepts a typed array
    const doc = await getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
    }
    return out;
  }
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  return new TextDecoder('utf-8').decode(buf);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => ({}));
  const storagePath = (body.storage_path || '').toString();
  const kind = ['performance_review', 'cv', 'manual_text'].includes(body.kind) ? body.kind : 'performance_review';
  const lang = normalizeLang(body.lang);
  const language = LANGUAGE_NAMES[lang] || 'English';
  if (!storagePath) return jsonError('storage_path_required');
  if (!storagePath.startsWith(`${ctx.user.id}/`)) return jsonError('forbidden', 403);

  // Storage path is expected to be `<auth.uid()>/<filename>` so RLS allows the user to read.
  // We use the service-role client to download (avoiding any token-pass plumbing).
  const { data: file, error: dlErr } = await ctx.sb.storage
    .from('profile-uploads')
    .download(storagePath);
  if (dlErr || !file) return jsonError(`download_failed: ${dlErr?.message ?? 'unknown'}`, 400);
  const filename = storagePath.split('/').slice(-1)[0];
  if (!/\.(pdf|docx|txt)$/i.test(filename)) return jsonError('unsupported_document_type', 400);
  if (file.size > 10 * 1024 * 1024) return jsonError('document_too_large', 413);

  let rawText: string;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    rawText = await extractText(buf, filename);
  } catch {
    return jsonError('document_read_failed', 400);
  }
  if (!rawText || rawText.trim().length < 20) return jsonError('text_too_short', 400);

  let proposed;
  let classifier_source;
  try {
    const result = await mistralJson<{ proposed?: unknown }>({
      feature: 'profile_ingest',
      system: `Extract a professional profile from the supplied document. Write descriptive text and skill names in ${language}. Return JSON with a proposed object containing: job_title (string), department (string), location (string), bio (string, max 500 characters), career_history (array of objects with company, role_title, start_year, end_year, description), can_teach (array of objects with skill and example_project), and wants_to_learn (array of strings). Use only explicit evidence from the document. Use empty strings or arrays when evidence is absent. Never infer sensitive personal data.`,
      user: JSON.stringify({ source_kind: kind, document_text: rawText.slice(0, 30000) }),
      temperature: 0,
      maxTokens: 1800,
    });
    if (!result.value?.proposed || typeof result.value.proposed !== 'object') return jsonError('ai_invalid_response', 502);
    proposed = result.value.proposed;
    classifier_source = `mistral:${result.model}`;
    const { data: owner } = await ctx.sb.from('profiles').select('organization_id').eq('id', ctx.user.id).maybeSingle();
    await recordAiRun(ctx.sb, {
      userId: ctx.user.id,
      organizationId: owner?.organization_id,
      feature: 'profile_ingest',
      promptVersion: PROMPT_VERSION,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    const mapped = aiErrorResponse(error);
    return jsonError(mapped.message, mapped.status);
  }

  const { data: insert, error: insErr } = await ctx.sb
    .from('profile_drafts')
    .insert({
      user_id: ctx.user.id,
      source: kind,
      raw_text: rawText.slice(0, 50000),
      proposed_json: proposed,
      classifier_source,
    })
    .select('id')
    .single();
  if (insErr) return jsonError(`insert_failed: ${insErr.message}`, 500);

  // Best-effort: clean up the upload after parsing.
  await ctx.sb.storage.from('profile-uploads').remove([storagePath]);

  return jsonOk({ draft_id: insert.id, proposed, classifier_source });
});
