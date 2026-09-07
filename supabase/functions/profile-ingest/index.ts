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
import { sampleProfile } from '../_shared/demo.ts';

async function extractText(buf: Uint8Array, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    // pdfjs accepts a typed array
    const doc = await getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((it: { str?: string }) => it.str ?? '').join(' ') + '\n';
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
  if (!storagePath) return jsonError('storage_path_required');
  if (!storagePath.startsWith(`${ctx.user.id}/`)) return jsonError('forbidden', 403);

  // Storage path is expected to be `<auth.uid()>/<filename>` so RLS allows the user to read.
  // We use the service-role client to download (avoiding any token-pass plumbing).
  const { data: file, error: dlErr } = await ctx.sb.storage
    .from('profile-uploads')
    .download(storagePath);
  if (dlErr || !file) return jsonError(`download_failed: ${dlErr?.message ?? 'unknown'}`, 400);

  let rawText: string;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const filename = storagePath.split('/').slice(-1)[0];
    rawText = await extractText(buf, filename);
  } catch {
    return jsonError('document_read_failed', 400);
  }
  if (!rawText || rawText.trim().length < 20) return jsonError('text_too_short', 400);

  // Validate and retain the uploaded text, but never claim to infer its profile.
  // Demo fixtures are unconditional, even when production AI credentials exist.
  const { proposed, classifier_source } = sampleProfile();

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
