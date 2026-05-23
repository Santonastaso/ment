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
import {
  escoExtract,
  escoRelevantToInput,
  isAcceptableCanonicalization,
} from '../_shared/esco.ts';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parseMonthYear(token: string) {
  const m = token.match(/(\d{4})/);
  if (!m) return { year: null as number | null, month: null as number | null };
  const year = parseInt(m[1], 10);
  const monthMatch = token.toLowerCase().match(/([a-z]+)/);
  let month: number | null = null;
  if (monthMatch) month = MONTHS[monthMatch[1]] ?? null;
  return { year, month };
}

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

function heuristicExtract(rawText: string) {
  const text = rawText || '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let job_title = '';
  let department = '';
  let location = '';
  let bio = '';
  const strengths: string[] = [];
  const growth_areas: string[] = [];
  const career_history: Array<{
    role_title: string;
    department: string;
    company: string;
    start_year: number | null;
    start_month: number | null;
    end_year: number | null;
    end_month: number | null;
  }> = [];

  const roleMatch = text.match(/(?:current role|position|job title|title)\s*[:\-]\s*(.+)/i);
  if (roleMatch) job_title = roleMatch[1].split('\n')[0].trim();
  const deptMatch = text.match(/(?:department|dept|team)\s*[:\-]\s*(.+)/i);
  if (deptMatch) department = deptMatch[1].split('\n')[0].trim();
  const locMatch = text.match(/(?:location|office)\s*[:\-]\s*(.+)/i);
  if (locMatch) location = locMatch[1].split('\n')[0].trim();

  let section: string | null = null;
  for (const line of lines) {
    if (/^(strengths?|key strengths?)\s*:?\s*$/i.test(line)) { section = 'strengths'; continue; }
    if (/^(areas? for development|growth areas?|development areas?|improvement)\s*:?\s*$/i.test(line)) { section = 'growth'; continue; }
    if (/^(career history|work history|experience)\s*:?\s*$/i.test(line)) { section = 'career'; continue; }
    if (/^(summary|bio|about)\s*:?\s*$/i.test(line)) { section = 'bio'; continue; }

    if (section === 'strengths' && line.startsWith('-')) strengths.push(line.replace(/^[-•*]\s*/, '').trim());
    if (section === 'growth' && line.startsWith('-')) growth_areas.push(line.replace(/^[-•*]\s*/, '').trim());
    if (section === 'bio' && !line.startsWith('-')) bio += (bio ? ' ' : '') + line;

    const dateRange = line.match(/([A-Za-z]+\s+\d{4}|\d{4})\s*[\u2013\-–]\s*([A-Za-z]+\s+\d{4}|\d{4}|present|current)/i);
    if (dateRange && section === 'career') {
      const start = parseMonthYear(dateRange[1]);
      const endRaw = dateRange[2].toLowerCase();
      const end = /present|current/.test(endRaw) ? { year: null, month: null } : parseMonthYear(dateRange[2]);
      const rolePart = line.split(/\d{4}/)[0].trim();
      career_history.push({
        role_title: rolePart || 'Role',
        department: department || '',
        company: '',
        start_year: start.year,
        start_month: start.month,
        end_year: end.year,
        end_month: end.month,
      });
    }
  }
  if (!bio && text.length < 800) bio = text.slice(0, 400).trim();

  return {
    job_title, department, location, bio,
    career_history: career_history.slice(0, 8),
    strengths: strengths.slice(0, 8),
    growth_areas: growth_areas.slice(0, 8),
  };
}

async function claudeExtractProfile(rawText: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;

  const systemPrompt =
    'Extract employee profile fields from HR/performance review text.\n' +
    'Output ONLY JSON:\n' +
    '{"job_title":"","department":"","location":"","bio":"","career_history":[{"role_title":"","department":"","company":"","start_year":null,"start_month":null,"end_year":null,"end_month":null}],"strengths":[],"growth_areas":[]}\n' +
    'strengths = skills they excel at. growth_areas = skills they need to develop. Max 8 items each.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: rawText.slice(0, 12000) }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function canonicalizeSkills(phrases: string[], context: string) {
  const out: { skill: string; uri: string }[] = [];
  const seen = new Set<string>();
  for (const phrase of (phrases || []).slice(0, 8)) {
    const p = (phrase || '').toString().trim();
    if (!p) continue;
    let canonical: { label: string; uri: string } = { label: p, uri: '' };
    const r = await escoExtract(p);
    for (const candidate of r ?? []) {
      if (isAcceptableCanonicalization(p, candidate.label) &&
          escoRelevantToInput(candidate.label, context + ' ' + p)) {
        canonical = candidate;
        break;
      }
    }
    const key = canonical.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ skill: canonical.label, uri: canonical.uri });
  }
  return out;
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

  // Storage path is expected to be `<auth.uid()>/<filename>` so RLS allows the user to read.
  // We use the service-role client to download (avoiding any token-pass plumbing).
  const { data: file, error: dlErr } = await ctx.sb.storage
    .from('profile-uploads')
    .download(storagePath);
  if (dlErr || !file) return jsonError(`download_failed: ${dlErr?.message ?? 'unknown'}`, 400);

  const buf = new Uint8Array(await file.arrayBuffer());
  const filename = storagePath.split('/').slice(-1)[0];
  const rawText = await extractText(buf, filename);
  if (!rawText || rawText.trim().length < 20) return jsonError('text_too_short', 400);

  const claude = await claudeExtractProfile(rawText);
  const base = claude ?? heuristicExtract(rawText);
  let classifier_source: string = claude ? 'claude' : 'heuristic';

  const can_teach = await canonicalizeSkills(base.strengths || [], rawText);
  const wants_to_learn = await canonicalizeSkills(base.growth_areas || [], rawText);
  const usedEsco = [...can_teach, ...wants_to_learn].some((s) => s.uri);
  if (claude && usedEsco) classifier_source = 'claude+esco';
  else if (!claude && usedEsco) classifier_source = 'esco';

  const proposed = {
    job_title: base.job_title || '',
    department: base.department || '',
    location: base.location || '',
    bio: base.bio || '',
    career_history: Array.isArray(base.career_history) ? base.career_history : [],
    can_teach: can_teach.map((s) => ({ skill: s.skill, example_project: '' })),
    wants_to_learn: wants_to_learn.map((s) => s.skill),
  };

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
