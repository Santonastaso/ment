const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { canonicalizePhrase } = require('./esco');

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

async function extractTextFromBuffer(buffer, filename = '') {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text || '';
  }
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  return buffer.toString('utf8');
}

function parseMonthYear(token) {
  const m = token.match(/(\d{4})/);
  if (!m) return { year: null, month: null };
  const year = parseInt(m[1], 10);
  const monthMatch = token.toLowerCase().match(/([a-z]+)/);
  let month = null;
  if (monthMatch) month = MONTHS[monthMatch[1]] || null;
  return { year, month };
}

function heuristicExtract(rawText) {
  const text = rawText || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let current_role = '';
  let department = '';
  let location = '';
  let bio = '';
  const strengths = [];
  const growth_areas = [];
  const career_history = [];

  const roleMatch = text.match(/(?:current role|position|job title|title)\s*[:\-]\s*(.+)/i);
  if (roleMatch) current_role = roleMatch[1].split('\n')[0].trim();

  const deptMatch = text.match(/(?:department|dept|team)\s*[:\-]\s*(.+)/i);
  if (deptMatch) department = deptMatch[1].split('\n')[0].trim();

  const locMatch = text.match(/(?:location|office)\s*[:\-]\s*(.+)/i);
  if (locMatch) location = locMatch[1].split('\n')[0].trim();

  let section = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^(strengths?|key strengths?)\s*:?\s*$/i.test(line)) { section = 'strengths'; continue; }
    if (/^(areas? for development|growth areas?|development areas?|improvement)\s*:?\s*$/i.test(line)) {
      section = 'growth'; continue;
    }
    if (/^(career history|work history|experience)\s*:?\s*$/i.test(line)) { section = 'career'; continue; }
    if (/^(summary|bio|about)\s*:?\s*$/i.test(line)) { section = 'bio'; continue; }

    if (section === 'strengths' && line.startsWith('-')) strengths.push(line.replace(/^[-•*]\s*/, '').trim());
    if (section === 'growth' && line.startsWith('-')) growth_areas.push(line.replace(/^[-•*]\s*/, '').trim());
    if (section === 'bio' && !line.startsWith('-')) bio += (bio ? ' ' : '') + line;

    const careerLine = line.match(
      /^(.+?)\s*(?:at|@|,)\s*(.+?)\s*[\u2013\-–]\s*(.+?)(?:\s*[\u2013\-–]\s*(.+))?$/i
    );
    if (careerLine || section === 'career') {
      const dateRange = line.match(/([A-Za-z]+\s+\d{4}|\d{4})\s*[\u2013\-–]\s*([A-Za-z]+\s+\d{4}|\d{4}|present|current)/i);
      if (dateRange) {
        const start = parseMonthYear(dateRange[1]);
        const endRaw = dateRange[2].toLowerCase();
        const end = /present|current/.test(endRaw) ? { year: null, month: null } : parseMonthYear(dateRange[2]);
        const rolePart = line.split(/\d{4}/)[0].trim();
        career_history.push({
          role: rolePart || 'Role',
          department: department || '',
          company: '',
          start_year: start.year,
          start_month: start.month,
          end_year: end.year,
          end_month: end.month,
        });
      }
    }
  }

  if (!bio && text.length < 800) bio = text.slice(0, 400).trim();

  return {
    current_role,
    department,
    location,
    bio,
    career_history: career_history.slice(0, 8),
    strengths: strengths.slice(0, 8),
    growth_areas: growth_areas.slice(0, 8),
  };
}

async function claudeExtractProfile(rawText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt =
    'Extract employee profile fields from HR/performance review text.\n' +
    'Output ONLY JSON:\n' +
    '{"current_role":"","department":"","location":"","bio":"","career_history":[{"role":"","department":"","company":"","start_year":null,"start_month":null,"end_year":null,"end_month":null}],"strengths":[],"growth_areas":[]}\n' +
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
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function canonicalizeSkills(phrases, contextText) {
  const out = [];
  const seen = new Set();
  for (const phrase of (phrases || []).slice(0, 8)) {
    const p = (phrase || '').toString().trim();
    if (!p) continue;
    const c = await canonicalizePhrase(p, contextText);
    const key = c.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ skill: c.label, uri: c.uri || '' });
  }
  return out;
}

async function extractStructuredProfile(rawText) {
  const claude = await claudeExtractProfile(rawText);
  const base = claude || heuristicExtract(rawText);
  let classifier_source = claude ? 'claude' : 'heuristic';

  const can_teach = await canonicalizeSkills(base.strengths, rawText);
  const wants_to_learn = await canonicalizeSkills(base.growth_areas, rawText);
  const usedEsco = [...can_teach, ...wants_to_learn].some(s => s.uri);
  if (claude && usedEsco) classifier_source = 'claude+esco';
  else if (!claude && usedEsco) classifier_source = 'esco';
  else if (claude) classifier_source = 'claude';

  return {
    proposed: {
      current_role: base.current_role || '',
      department: base.department || '',
      location: base.location || '',
      bio: base.bio || '',
      career_history: Array.isArray(base.career_history) ? base.career_history : [],
      can_teach: can_teach.map(s => ({ skill: s.skill, example_project: '' })),
      wants_to_learn: wants_to_learn.map(s => s.skill),
    },
    classifier_source,
  };
}

module.exports = { extractTextFromBuffer, extractStructuredProfile, heuristicExtract };
