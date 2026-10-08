// Profile ingest (Deno port of server/routes/profile-ingest.js + profileExtractor.js).
// Body: { storage_path: string }
// Returns: { draft_id, proposed, classifier_source }

import mammoth from 'npm:mammoth@1.9.0';
import { Buffer } from 'node:buffer';
import {
  corsHeaders,
  jsonError,
  jsonOk,
  requireUser,
} from '../_shared/index.ts';
import { recordAiRun } from '../_shared/ai-telemetry.ts';
import { aiErrorResponse, mistralJson } from '../_shared/mistral.ts';
import { normalizeLang } from '../_shared/esco.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { CITY_OPTIONS, normalizeCity } from '../../../shared/cities.mjs';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French' };
const PROMPT_VERSION = 'profile-ingest-v3';
const MAX_EXTRACTED_CHARS = 30000;
const MAX_PDF_PAGES = 100;
const MAX_DOCX_UNCOMPRESSED = 4 * 1024 * 1024;
const string = { type: 'string' };
const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    proposed: {
      type: 'object',
      properties: {
        job_title: string, department: string, location: string, bio: string,
        career_history: {
          type: 'array', items: {
            type: 'object',
            properties: { company: string, role_title: string, start_year: string, end_year: string, description: string },
            required: ['company', 'role_title', 'start_year', 'end_year', 'description'],
            additionalProperties: false,
          },
        },
        can_teach: {
          type: 'array', items: {
            type: 'object', properties: { skill: string, example_project: string },
            required: ['skill', 'example_project'], additionalProperties: false,
          },
        },
        wants_to_learn: { type: 'array', items: string },
      },
      required: ['job_title', 'department', 'location', 'bio', 'career_history', 'can_teach', 'wants_to_learn'],
      additionalProperties: false,
    },
  },
  required: ['proposed'],
  additionalProperties: false,
};

function validateDocxArchive(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('invalid_docx');
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries > 512 || offset + directorySize > eocd) throw new Error('invalid_docx');
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buf.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('invalid_docx');
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new Error('unsupported_docx');
    expanded += size;
    if (expanded > MAX_DOCX_UNCOMPRESSED) throw new Error('document_too_large');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset > eocd) throw new Error('invalid_docx');
}

async function extractText(buf: Uint8Array, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    // Loading PDF.js only for PDFs keeps a PDF runtime failure from blocking DOCX and TXT imports.
    const { getDocument } = await import('npm:pdfjs-dist@4.7.76/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: buf }).promise;
    if (doc.numPages > MAX_PDF_PAGES) throw new Error('document_too_many_pages');
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
      if (out.length > MAX_EXTRACTED_CHARS) throw new Error('document_text_too_large');
    }
    return out;
  }
  if (lower.endsWith('.docx')) {
    validateDocxArchive(buf);
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    if (result.value.length > MAX_EXTRACTED_CHARS) throw new Error('document_text_too_large');
    return result.value || '';
  }
  return new TextDecoder('utf-8').decode(buf);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405);

  let ctx;
  try { ctx = await requireUser(req); } catch (r) { return r as Response; }
  try {
    if (!await enforceRateLimit(ctx.sb, 'profile-ingest', ctx.user.id, 10, 3600)) {
      return jsonError('rate_limited', 429);
    }
  } catch {
    return jsonError('rate_limit_unavailable', 503);
  }

  const body = await req.json().catch(() => ({}));
  const storagePath = (body.storage_path || '').toString();
  const kind = 'cv';
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
  if (!/\.(pdf|docx)$/i.test(filename)) return jsonError('unsupported_document_type', 400);
  if (file.size > 10 * 1024 * 1024) return jsonError('document_too_large', 413);

  let rawText: string;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    rawText = await extractText(buf, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const safeCode = /^[a-z0-9_]{1,64}$/i.test(message) ? message : 'parser_error';
    console.error(JSON.stringify({
      event: 'profile_ingest_document_read_failed',
      file_type: filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
      error_code: safeCode,
      error_name: error instanceof Error ? error.name : 'unknown',
    }));
    return jsonError('document_read_failed_or_too_complex', 400);
  }
  if (!rawText || rawText.trim().length < 20) return jsonError('text_too_short', 400);

  let proposed;
  let classifier_source;
  const startedAt = Date.now();
  try {
    const result = await mistralJson<{ proposed?: unknown }>({
      feature: 'profile_ingest',
      system: `Extract a professional profile from the supplied document. Write descriptive text and skill names in ${language}. The bio must be written in first person as the profile owner's own words, starting with “I” (or the equivalent in ${language}); never describe the owner by name or as he/she/they. For location, return exactly one current city from this list when possible: ${CITY_OPTIONS.join(', ')}. Otherwise return exactly one current city or “Remote”; never return multiple places, countries, alternatives, or explanations. Return JSON with a proposed object containing: job_title (string), department (string), location (string), bio (string, max 500 characters), career_history (array of objects with company, role_title, start_year, end_year, description), can_teach (array of objects with skill and example_project, where example_project is at most 80 characters), and wants_to_learn (array of strings). Use short, conventional skill names as they would appear in a professional skills list: two or three words, lower case, noun form. Use only explicit evidence from the document. Use empty strings or arrays when evidence is absent. Never infer sensitive personal data.`,
      user: JSON.stringify({ source_kind: kind, document_text: rawText.slice(0, 30000) }),
      temperature: 0,
      maxTokens: 3000,
      schema: PROFILE_SCHEMA,
    });
    if (!result.value?.proposed || typeof result.value.proposed !== 'object') {
      console.error(JSON.stringify({ event: 'profile_ingest_invalid_shape', model: result.model }));
      return jsonError('ai_invalid_response', 502);
    }
    proposed = result.value.proposed;
    if (typeof proposed.location === 'string') proposed.location = normalizeCity(proposed.location);
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
    const { data: owner } = await ctx.sb.from('profiles').select('organization_id').eq('id', ctx.user.id).maybeSingle();
    await recordAiRun(ctx.sb, {
      userId: ctx.user.id, organizationId: owner?.organization_id, feature: 'profile_ingest',
      promptVersion: PROMPT_VERSION, model: 'unknown', latencyMs: Date.now() - startedAt,
      status: 'failed', errorCode: mapped.message,
    });
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
