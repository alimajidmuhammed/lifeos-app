import { z } from 'zod';
import { evaluatePrivacyGate } from './privacyGate';

export type NoteAiMode = 'summarize' | 'action_items' | 'polish';

export const NoteAssistResultSchema = z.object({
  summary: z.string().min(1).max(1500),
  actionItems: z.array(z.string().trim().min(1).max(180)).max(10).default([]),
  polishedMarkdown: z.string().max(20000).nullable().optional().default(null),
});

export type NoteAssistResult = z.infer<typeof NoteAssistResultSchema>;

export interface NoteAiSuccess {
  ok: true;
  data: NoteAssistResult;
  meta: {
    modelUsed: string;
    latencyMs: number;
    inputTokensEst: number;
    outputTokensEst: number;
  };
}

export interface NoteAiFailure {
  ok: false;
  code: string;
  error: string;
}

export async function requestNoteAssist(params: {
  title: string;
  content: string;
  mode: NoteAiMode;
  locale: 'en' | 'ar' | 'ckb';
  isLockedOrEncrypted: boolean;
  freeTier: boolean;
}): Promise<NoteAiSuccess | NoteAiFailure> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'notes',
    text: `${params.title}\n${params.content}`,
    containsLockedOrE2E: params.isLockedOrEncrypted,
  });
  if (!gate.allowed) {
    return {
      ok: false,
      code: gate.code ?? 'PRIVACY_BLOCKED',
      error: gate.reason ?? 'Blocked by LifeOS Privacy Gate.',
    };
  }

  try {
    const resp = await fetch('/api/ai/notes/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        content: params.content.slice(0, 6000),
        mode: params.mode,
        locale: params.locale,
        isLockedOrEncrypted: params.isLockedOrEncrypted,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      return {
        ok: false,
        code: json?.code || 'AI_ERROR',
        error: json?.error || 'Could not analyze note right now.',
      };
    }
    const parsed = NoteAssistResultSchema.safeParse(json.data);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_AI_RESPONSE',
        error: 'AI note response did not match the expected schema.',
      };
    }
    return { ok: true, data: parsed.data, meta: json.meta };
  } catch {
    return {
      ok: false,
      code: 'OFFLINE_OR_NETWORK',
      error: 'Offline or unable to reach AI proxy. Your Markdown editor remains fully usable offline.',
    };
  }
}
