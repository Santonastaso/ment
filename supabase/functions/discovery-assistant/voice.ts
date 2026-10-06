// The chat's voice. Every reply starts as a template that is known to be
// right; Mistral then says it again the way a warm, slightly playful person
// would, so the conversation does not read as canned. Code checks the
// rewrite kept every fact and added none -- any doubt and the template stands.

const STARTS_SENTENCE = /(^|[.!?—:]\s*|["“«(]\s*)$/u;
const ALWAYS_ALLOWED = new Set(['i', 'ment', 'essec']);
const FORBIDDEN = /\b(profiles?|database|candidates?|algorithm|artificial intelligence|language model|AI|bot|chatbot|search engine|json|coverage|records?)\b|\p{Extended_Pictographic}/u;

const wordList = (text: string) => [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}&'’-]*/gu)].map((match) => ({ word: match[0], at: match.index || 0 }));
// Capitalised words that do not start a sentence: names, places, employers,
// acronyms. These are the facts a rewrite must not drop or invent.
const properNouns = (text: string) => wordList(text)
  .filter(({ word, at }) => /\p{Lu}/u.test(word) && !STARTS_SENTENCE.test(text.slice(0, at)))
  .map(({ word }) => word);
const numbers = (text: string) => text.match(/\d+/g) || [];
const quoted = (text: string) => [...text.matchAll(/["“«]\s*([^"”»]+?)\s*["”»]/g)].map((match) => match[1]);

export function keepsFacts(original: string, rewritten: string, userMessage: string) {
  if (!rewritten || rewritten.length > 480 || FORBIDDEN.test(rewritten)) return false;
  const before = wordList(original).length;
  const after = wordList(rewritten).length;
  if (after < before * 0.5 || after > before * 1.6 + 10) return false;
  // A question may be added -- that is often what makes it engaging -- but
  // one that was asked must still be asked.
  if (original.includes('?') && !rewritten.includes('?')) return false;
  // Nothing dropped.
  if (properNouns(original).some((noun) => !rewritten.includes(noun))) return false;
  if (quoted(original).some((phrase) => !rewritten.includes(phrase))) return false;
  if (numbers(original).some((value) => !numbers(rewritten).includes(value))) return false;
  // Nothing added: no new name, place, employer or number.
  const known = new Set([...wordList(original), ...wordList(userMessage)].flatMap(({ word }) => [word.toLowerCase(), word.toLowerCase().split(/['’]/)[0]]));
  const base = (noun: string) => noun.toLowerCase().split(/['’]/)[0];
  if (properNouns(rewritten).some((noun) => !known.has(noun.toLowerCase()) && !known.has(base(noun)) && !ALWAYS_ALLOWED.has(base(noun)))) return false;
  if (numbers(rewritten).some((value) => !numbers(original).includes(value))) return false;
  return true;
}

export const VOICE_PROMPT = (language: string) => `You are Ment, the assistant of ESSEC's mentoring network, chatting with a student or alumnus. Rewrite "message" in ${language} so it sounds like a warm, upbeat person talking -- engaging, natural and lightly playful where it fits, always respectful, never sarcastic or over the top. Vary your wording; do not open with "Great" or "Sure" every time.
Keep exactly the same meaning: every name, place, company, number, quoted phrase and option it mentions, and end with the same question if it asks one. Do not add facts, people, places, promises or details, and do not drop any. Never mention profiles, databases, candidates, searches, algorithms, AI or yourself as a bot. No emojis, no markdown. Keep it about the same length.
"user_said" is the user's last message, for tone only: if it was playful or impossible, a gentle joke is welcome.
"previous_replies" are your last messages in this conversation. Never reuse their sentences, openings or closing lines -- a person does not repeat themselves word for word. Do not end with a stock offer like "just say" or "happy to help".
Return JSON only: {"text":"..."}`;

// Sentences said in the last replies are not said again, verbatim or nearly:
// two sentences repeat when most of their meaningful words are shared.
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
const FILLER = new Set(['the', 'and', 'for', 'you', 'are', 'was', 'but', 'that', 'this', 'with', 'have', 'they', 'them', 'your', 'who', 'one']);
// Stems, so "someone different" and "some different people" share words.
const meaningful = (text: string) => new Set(wordList(text).map(({ word }) => word.toLowerCase().replace(/['’].*$/, ''))
  .filter((word) => word.length >= 3 && !FILLER.has(word)).map((word) => word.slice(0, 5)));
function sameSentence(a: string, b: string) {
  const x = meaningful(a);
  const y = meaningful(b);
  if (x.size < 2 || y.size < 2) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / Math.min(x.size, y.size) >= 0.6;
}
const opener = (text: string) => wordList(text).slice(0, 2).map(({ word }) => word.toLowerCase()).join(' ');
// Starting two replies in a row the same way ("Got it — ...", "Got it — ...")
// reads as canned even when the rest differs.
export function sameOpening(text: string, recent: string[]) {
  const start = opener(text);
  return Boolean(start) && recent.some((reply) => sentences(reply).some((sentence) => opener(sentence) === start));
}
export function repeats(text: string, recent: string[]) {
  const before = recent.flatMap(sentences);
  return sentences(text).some((sentence) => before.some((other) => sameSentence(sentence, other)));
}
// Drops sentences already said recently, keeping at least the first one.
export function withoutRepeats(text: string, recent: string[]) {
  const before = recent.flatMap(sentences);
  const parts = sentences(text);
  const kept = parts.filter((sentence, index) => index === 0 || !before.some((other) => sameSentence(sentence, other)));
  return kept.join(' ');
}
