import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function recordAiRun(
  sb: SupabaseClient,
  value: {
    userId: string;
    organizationId?: string | null;
    feature: 'discovery_match' | 'discovery_draft' | 'profile_ingest' | 'reflection';
    promptVersion: string;
    model: string;
    latencyMs: number;
  },
) {
  try {
    await sb.from('ai_runs').insert({
      user_id: value.userId,
      organization_id: value.organizationId || null,
      feature: value.feature,
      prompt_version: value.promptVersion,
      model: value.model,
      status: 'succeeded',
      latency_ms: Math.max(0, Math.round(value.latencyMs)),
    });
  } catch {
    // Telemetry must never block the user-facing AI operation.
  }
}
