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

function configuration() {
  const enabled = (Deno.env.get('AI_PROCESSING_ENABLED') || '').toLowerCase() === 'true';
  const apiKey = Deno.env.get('MISTRAL_API') || Deno.env.get('MISTRAL_API_KEY') || '';
  const model = Deno.env.get('MISTRAL_MODEL') || '';
  if (!enabled || !apiKey || !model) throw new AiNotConfiguredError();
  return { apiKey, model };
}

export async function mistralJson<T>(options: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ value: T; model: string }> {
  const { apiKey, model } = configuration();
  const response = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
    }),
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new AiProviderError(retryable ? 'ai_temporarily_unavailable' : 'ai_request_failed', retryable ? 503 : 502);
  }
  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AiProviderError('ai_invalid_response');
  try {
    return { value: JSON.parse(content) as T, model: payload?.model || model };
  } catch {
    throw new AiProviderError('ai_invalid_response');
  }
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiNotConfiguredError) return { message: error.message, status: 503 };
  if (error instanceof AiProviderError) return { message: error.message, status: error.status };
  return { message: 'ai_request_failed', status: 502 };
}
