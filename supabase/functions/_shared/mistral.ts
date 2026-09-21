const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

export class AiNotConfiguredError extends Error {
  constructor() { super('ai_not_configured'); }
}

export class AiProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function configuration(feature?: string) {
  const enabled = (Deno.env.get('AI_PROCESSING_ENABLED') || '').toLowerCase() === 'true';
  const apiKey = Deno.env.get('MISTRAL_API') || Deno.env.get('MISTRAL_API_KEY') || '';
  const featureKey = feature ? `MISTRAL_MODEL_${feature.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}` : '';
  const model = (featureKey && Deno.env.get(featureKey)) || Deno.env.get('MISTRAL_MODEL') || '';
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
  return { apiKey, model };
}

function providerError(status: number) {
  if (status === 401 || status === 403) return new AiProviderError('ai_provider_auth_failed', 502);
  if (status === 404) return new AiProviderError('ai_model_not_found', 502);
  if (status === 429) return new AiProviderError('ai_rate_limited', 503);
  if (status >= 500) return new AiProviderError('ai_temporarily_unavailable', 503);
  return new AiProviderError('ai_request_failed', 502);
}

export async function mistralJson<T>(options: {
  system: string;
  user: string;
  feature?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ value: T; model: string; latencyMs: number }> {
  const startedAt = performance.now();
  const { apiKey, model } = configuration(options.feature);
  const requestBody = JSON.stringify({
    model,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  });
  const callProvider = async () => {
    try {
      return await fetch(MISTRAL_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: requestBody,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'mistral_network_error',
        model,
        error: error instanceof Error ? error.name : 'unknown',
      }));
      throw new AiProviderError('ai_provider_unreachable', 503);
    }
  };

  let response = await callProvider();
  for (const delay of [500, 1500]) {
    if (response.ok || (response.status !== 429 && response.status < 500)) break;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await callProvider();
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
    throw providerError(response.status);
  }
  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AiProviderError('ai_invalid_response');
  try {
    return {
      value: JSON.parse(content) as T,
      model: payload?.model || model,
      latencyMs: performance.now() - startedAt,
    };
  } catch {
    throw new AiProviderError('ai_invalid_response');
  }
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiNotConfiguredError) return { message: error.message, status: 503 };
  if (error instanceof AiProviderError) return { message: error.message, status: error.status };
  return { message: 'ai_request_failed', status: 502 };
}
