import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Reuse Vite's compiler, but execute the real Edge handler and Mistral adapter.
const { build } = createRequire(new URL('../../client/package.json', import.meta.url))('esbuild');
const stubs = {
  'index.ts': `export const corsHeaders = {}; export const requireUser = async () => fixture;
    export const jsonOk = data => Response.json(data);
    export const jsonError = (error, status = 400) => Response.json({error}, {status});`,
  'rate-limit.ts': 'export const enforceRateLimit = async () => !fixture.rateLimited;',
  'ai-telemetry.ts': 'export const recordAiRun = async (sb, row) => fixture.telemetry.push(row);',
};

export async function discoveryHandler() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../../supabase/functions/discovery-assistant/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    banner: { js: `let fixture, handler;
      const Deno = {serve: fn => {handler = fn}, env: {get: key => fixture.env[key]}};
      const fetch = (...args) => fixture.fetch(...args);` },
    footer: { js: `export async function run(context, body) {
      fixture = context;
      return handler(new Request('https://fixture.invalid/discovery', {method:'POST',body:JSON.stringify(body)}));
    }` },
    plugins: [{ name: 'fixture-boundaries', setup(builder) {
      builder.onResolve({ filter: /\/_shared\/(index|rate-limit|ai-telemetry)\.ts$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const { run } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  return run;
}

export const finance = { id: 'finance', name: 'Finance Mentor', job_title: 'Financial Analyst', department: 'Finance', program: 'Masters', skills: ['Financial modelling'], location: 'Paris' };
export const directMatch = { outcome: 'matches', matches: [{ profile_id: finance.id, confidence: 0.9, reasons: ['Teaches financial modelling.'], matched_expertise: ['Financial modelling'] }] };

export function discoveryFixture({ candidates = [finance], turns = [], responses = [], live = false, voice = false } = {}) {
  let thread = turns.length ? { id: 'thread', turns: structuredClone(turns) } : null;
  const context = {
    user: { id: 'viewer' }, telemetry: [], calls: [], queries: [],
    env: live ? { ...process.env, AI_PROCESSING_ENABLED: 'true' } : { AI_PROCESSING_ENABLED: 'true', MISTRAL_API: 'fixture-only', MISTRAL_MODEL: 'fixture-model', DISCOVERY_VOICE: voice ? 'on' : 'off' },
    async fetch(url, options) {
      if (url !== 'https://api.mistral.ai/v1/chat/completions') throw new Error('Unexpected provider');
      const request = JSON.parse(options.body);
      context.calls.push(request);
      if (live) return globalThis.fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      const value = responses.shift();
      if (value === undefined) throw new Error('Unexpected model call');
      return Response.json({ model: 'fixture-model', choices: [{ message: { content: JSON.stringify(value) } }] });
    },
    sb: {
      rpc: async (name, args) => {
        context.queries.push({ name, args });
        if (name === 'discovery_candidates') return { data: candidates };
        if (name === 'discovery_network_coverage') return { data: {
          member_count: candidates.length,
          departments: candidates.map(c => c.department), programs: candidates.map(c => c.program),
          job_titles: candidates.map(c => c.job_title), skills: candidates.flatMap(c => c.skills),
        } };
        throw new Error(`Unexpected RPC: ${name}`);
      },
      from(table) {
        let mutation;
        const result = () => {
          if (table === 'profiles') return { data: { id: 'viewer', name: 'Viewer Student', organization_id: 'organization' } };
          if (table === 'organizations') return { data: { type: 'intra' } };
          if (table === 'sessions' || table === 'connections') return { data: [] };
          if (table === 'discovery_threads') {
            if (mutation) { thread = { id: 'thread', ...thread, ...mutation }; mutation = null; }
            return { data: thread };
          }
          throw new Error(`Unexpected table: ${table}`);
        };
        const query = {
          select() { return this; }, or() { return this; }, in() { return this; },
          eq(key, value) { context.queries.push({ table, key, value }); return this; },
          insert(value) { mutation = value; return this; }, update(value) { mutation = value; return this; },
          single: async () => result(), maybeSingle: async () => result(),
          then: (resolve, reject) => Promise.resolve().then(result).then(resolve, reject),
        };
        return query;
      },
    },
    get thread() { return thread; },
  };
  return context;
}
