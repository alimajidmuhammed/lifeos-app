import { z } from 'zod';
import { evaluatePrivacyGate } from './privacyGate';

export const PlannerBreakdownDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  listId: z.enum(['inbox', 'personal', 'work', 'finance', 'health']).default('inbox'),
  priority: z.number().int().min(1).max(4).default(2),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  notes: z.string().max(1000).nullable().optional().default(null),
  subtasks: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
});

export type PlannerBreakdownDraft = z.infer<typeof PlannerBreakdownDraftSchema>;

export interface PlannerAiResponse<T> {
  ok: true;
  data: T;
  meta: {
    modelUsed: string;
    latencyMs: number;
    inputTokensEst: number;
    outputTokensEst: number;
  };
}

export interface PlannerAiFailure {
  ok: false;
  code: string;
  error: string;
}

export async function requestGoalBreakdown(params: {
  goal: string;
  locale: import('../currency/currency').SupportedLocale;
  todayYmd: string;
  freeTier: boolean;
}): Promise<PlannerAiResponse<PlannerBreakdownDraft> | PlannerAiFailure> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'planner',
    text: params.goal,
  });
  if (!gate.allowed) {
    return { ok: false, code: gate.code ?? 'PRIVACY_BLOCKED', error: gate.reason ?? 'Blocked by Privacy Gate.' };
  }

  try {
    const resp = await fetch('/api/ai/planner/breakdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: params.goal,
        locale: params.locale,
        todayYmd: params.todayYmd,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      return {
        ok: false,
        code: json?.code || 'AI_ERROR',
        error: json?.error || 'Could not break down goal automatically.',
      };
    }
    const parsed = PlannerBreakdownDraftSchema.safeParse(json.data);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_AI_DRAFT',
        error: 'AI response did not match the task breakdown schema.',
      };
    }
    return { ok: true, data: parsed.data, meta: json.meta };
  } catch {
    return {
      ok: false,
      code: 'OFFLINE_OR_NETWORK',
      error: 'Offline or unable to reach AI proxy. Create your task and subtasks directly.',
    };
  }
}
