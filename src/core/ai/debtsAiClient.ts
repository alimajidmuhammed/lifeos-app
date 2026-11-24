import { z } from 'zod';
import type { CurrencyCode, SupportedLocale } from '../currency/currency';
import { evaluatePrivacyGate } from './privacyGate';
import {
  AIParsedDebtDraftSchema,
  type AIParsedDebtDraft,
  type DebtDirection,
} from '../debts/debtSchemas';

export interface DebtDraftMessageResult {
  shortSubject: string;
  message: string;
}

const DebtDraftMessageSchema = z.object({
  shortSubject: z.string(),
  message: z.string(),
});

export interface DebtsAIMeta {
  modelUsed: string;
  latencyMs: number;
  inputTokensEst: number;
  outputTokensEst: number;
}

export type DebtsAIResponse<T> =
  | { ok: true; data: T; meta: DebtsAIMeta }
  | { ok: false; error: string; code: string; privacyBlocked?: boolean };

export async function parseNaturalLanguageDebt(params: {
  text: string;
  locale: SupportedLocale;
  defaultCurrency: CurrencyCode;
  todayYmd: string;
  freeTier: boolean;
}): Promise<DebtsAIResponse<AIParsedDebtDraft>> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'debts',
    text: params.text,
  });
  if (!gate.allowed) {
    return { ok: false, error: gate.reason, code: gate.code, privacyBlocked: true };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      code: 'OFFLINE',
      error: 'You are offline. Fill out the Add Debt form directly — it saves locally immediately.',
    };
  }

  try {
    const res = await fetch('/api/ai/debts/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text,
        locale: params.locale,
        defaultCurrency: params.defaultCurrency,
        todayYmd: params.todayYmd,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        privacyBlocked: Boolean(body.privacyBlocked),
        code: String(body.code ?? 'HTTP_ERROR'),
        error: String(body.error ?? 'Could not parse debt text.'),
      };
    }
    const parsed = AIParsedDebtDraftSchema.safeParse(body.data);
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_AI_SCHEMA', error: 'AI returned an unexpected draft format.' };
    }
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: parsed.data,
      meta: {
        modelUsed: String(meta.modelUsed ?? 'gemini-4-hydrogen'),
        latencyMs: Number(meta.latencyMs ?? 0),
        inputTokensEst: Number(meta.inputTokensEst ?? 0),
        outputTokensEst: Number(meta.outputTokensEst ?? 0),
      },
    };
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      error: 'Could not reach LifeOS AI service. Manual debt entry works completely offline.',
    };
  }
}

export async function draftDebtReminderMessage(params: {
  personName: string;
  formattedAmount: string;
  direction: DebtDirection;
  dueDate?: string | null;
  daysOverdue: number;
  tone: 'gentle' | 'firm' | 'formal';
  language: SupportedLocale;
  contextNote?: string;
  freeTier: boolean;
}): Promise<DebtsAIResponse<DebtDraftMessageResult>> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'debts',
    text: `${params.personName} ${params.contextNote ?? ''}`,
  });
  if (!gate.allowed) {
    return { ok: false, error: gate.reason, code: gate.code, privacyBlocked: true };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      code: 'OFFLINE',
      error: 'You are offline. You can still write and copy a manual message below.',
    };
  }

  try {
    const res = await fetch('/api/ai/debts/draft-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName: params.personName,
        formattedAmount: params.formattedAmount,
        direction: params.direction,
        dueDate: params.dueDate ?? null,
        daysOverdue: params.daysOverdue,
        tone: params.tone,
        language: params.language,
        contextNote: params.contextNote,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        privacyBlocked: Boolean(body.privacyBlocked),
        code: String(body.code ?? 'HTTP_ERROR'),
        error: String(body.error ?? 'Could not draft reminder.'),
      };
    }
    const parsed = DebtDraftMessageSchema.safeParse(body.data);
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_AI_SCHEMA', error: 'AI returned malformed reminder output.' };
    }
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: parsed.data,
      meta: {
        modelUsed: String(meta.modelUsed ?? 'gemini-3.1-flash-lite'),
        latencyMs: Number(meta.latencyMs ?? 0),
        inputTokensEst: Number(meta.inputTokensEst ?? 0),
        outputTokensEst: Number(meta.outputTokensEst ?? 0),
      },
    };
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      error: 'Unable to reach LifeOS AI service right now.',
    };
  }
}
