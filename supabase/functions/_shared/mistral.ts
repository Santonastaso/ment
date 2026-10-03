const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

export class AiNotConfiguredError extends Error {
  constructor() { super('ai_not_configured'); }
}

export class AiProviderError extends Error {
  status: number;
  // The provider's own status/code/message. Edge function logs need the
  // dashboard to read, so without this a 400 from Mistral is indistinguishable
  // from any other failure to anyone working from SQL.
  detail: string;
  constructor(message: string, status = 502, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Discovery needs real semantic judgement: on ministral-3b the clarify step
// answered "no" to almost every coverage question and missed obvious
// neighbours. A per-feature secret (MISTRAL_MODEL_DISCOVERY_MATCH etc.) still
// overrides this, so it can be changed without a deploy.
const FEATURE_MODEL_DEFAULTS: Record<string, string> = {
  discovery_clarify: 'mistral-small-latest',
  discovery_match: 'mistral-small-latest',
};

function configuration(feature?: string) {
  const enabled = (Deno.env.get('AI_PROCESSING_ENABLED') || '').toLowerCase() === 'true';
  const apiKey = Deno.env.get('MISTRAL_API') || Deno.env.get('MISTRAL_API_KEY') || '';
  const featureKey = feature ? `MISTRAL_MODEL_${feature.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}` : '';
  const explicit = featureKey ? Deno.env.get(featureKey) || '' : '';
  const configured = Deno.env.get('MISTRAL_MODEL') || '';
  const model = explicit || (feature && FEATURE_MODEL_DEFAULTS[feature]) || configured;
  // A code default is a preference, not a requirement. If the account cannot
  // serve it -- quota, plan, outage -- fall back to the model already
  // configured for this deployment rather than failing the user's request.
  const fallbackModel = !explicit && configured && configured !== model ? configured : '';
  if (!enabled || !apiKey || !model) {
    console.error(JSON.stringify({
      event: 'mistral_configuration_error',
      enabled,
      has_api_key: Boolean(apiKey),
      has_model: Boolean(model),
      feature: feature || 'default',
    }));
    throw new AiNotConfiguredError();
  }
  return { apiKey, model, fallbackModel };
}

function providerError(status: number, detail = '') {
  if (status === 401 || status === 403) return new AiProviderError('ai_provider_auth_failed', 502, detail);
  if (status === 404) return new AiProviderError('ai_model_not_found', 502, detail);
  if (status === 429) return new AiProviderError('ai_rate_limited', 503, detail);
  if (status >= 500) return new AiProviderError('ai_temporarily_unavailable', 503, detail);
  return new AiProviderError('ai_request_failed', 502, detail);
}

export async function mistralJson<T>(options: {
  system: string;
  user: string;
  feature?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ value: T; model: string; latencyMs: number }> {
  const startedAt = performance.now();
  const { apiKey, model: preferredModel, fallbackModel } = configuration(options.feature);
  let model = preferredModel;
  const bodyFor = (name: string) => JSON.stringify({
    model: name,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  });
  const callProvider = async (name: string) => {
    try {
      return await fetch(MISTRAL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: bodyFor(name),
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'mistral_network_error',
        model: name,
        error: error instanceof Error ? error.name : 'unknown',
      }));
      throw new AiProviderError('ai_provider_unreachable', 503);
    }
  };
  const attempt = async (name: string) => {
    let result = await callProvider(name);
    for (const delay of [500, 1500]) {
      if (result.ok || (result.status !== 429 && result.status < 500)) break;
      await result.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, delay));
      result = await callProvider(name);
    }
    return result;
  };

  let response = await attempt(model);
  if (!response.ok && fallbackModel) {
    console.error(JSON.stringify({ event: 'mistral_model_fallback', from: model, to: fallbackModel, status: response.status }));
    await response.body?.cancel();
    model = fallbackModel;
    response = await attempt(model);
  }
  if (!response.ok) {
    let providerType = '';
    let providerCode = '';
    let providerMessage = '';
    try {
      const body = await response.json();
      providerType = String(body?.type || body?.object || '').slice(0, 80);
      providerCode = String(body?.code || '').slice(0, 80);
      providerMessage = String(body?.message || '').slice(0, 180);
    } catch {
      // The HTTP status remains sufficient when the provider sends a non-JSON body.
    }
    console.error(JSON.stringify({
      event: 'mistral_http_error',
      status: response.status,
      model,
      provider_type: providerType,
      provider_code: providerCode,
      provider_message: providerMessage,
      retry_after: response.headers.get('retry-after'),
      rate_limit_remaining: response.headers.get('x-ratelimit-remaining'),
    }));
    throw providerError(response.status, [response.status, providerCode || providerType, providerMessage].filter(Boolean).join(' ').slice(0, 280));
  }
  // Small models occasionally return truncated or malformed JSON. One fresh
  // attempt recovers most of those; a second failure is reported as before.
  for (let tries = 0; ; tries += 1) {
    const payload = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    try {
      if (typeof content !== 'string' || !content.trim()) throw new Error('empty');
      return {
        value: JSON.parse(content) as T,
        model: payload?.model || model,
        latencyMs: performance.now() - startedAt,
      };
    } catch {
      if (tries >= 1) throw new AiProviderError('ai_invalid_response');
      response = await attempt(model);
      if (!response.ok) throw new AiProviderError('ai_invalid_response');
    }
  }
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiNotConfiguredError) return { message: error.message, status: 503, detail: '' };
  if (error instanceof AiProviderError) return { message: error.message, status: error.status, detail: error.detail };
  // Anything that is not an AiProviderError reached here by being thrown inside
  // the caller's try block -- a bug in our own code, not a provider refusal.
  // Without the name and message it is indistinguishable from a provider 400.
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  return { message: 'ai_request_failed', status: 502, detail: detail.slice(0, 280) };
}
