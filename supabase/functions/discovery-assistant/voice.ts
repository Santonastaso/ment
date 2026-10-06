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
  if (after < before * 0.5 || after > before * 1.5 + 8) return false;
  if (original.includes('?') !== rewritten.includes('?')) return false;
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
Return JSON only: {"text":"..."}`;
