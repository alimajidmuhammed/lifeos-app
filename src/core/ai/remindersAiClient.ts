import type { SupportedLocale } from '../currency/currency';
import type { ReminderCategory, ReminderPriority } from '../reminders/reminderSchemas';
import { evaluatePrivacyGate } from './privacyGate';

export interface ParsedReminderDraft {
  title: string;
  category: ReminderCategory;
  priority: ReminderPriority;
  dueDateYmd: string;
  dueTimeHHMM: string;
  rrule: string | null;
  respectQuietHours: boolean;
  notes: string | null;
  confidenceNote: string | null;
}

export type ReminderAiParseResult =
  | {
      ok: true;
      data: ParsedReminderDraft;
      meta: {
        modelUsed: string;
        latencyMs: number;
        inputTokensEst: number;
        outputTokensEst: number;
      };
    }
  | {
      ok: false;
      error: string;
      code: string;
      privacyBlocked?: boolean;
    };

/**
 * Privacy-gated natural-language reminder parser (EN / AR / Kurdish Sorani).
 * Always returns an editable preview draft — never writes directly to Firestore.
 */
export async function parseNaturalLanguageReminder(params: {
  text: string;
  locale: SupportedLocale;
  nowLocalIso: string;
  freeTier: boolean;
}): Promise<ReminderAiParseResult> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'reminders',
    text: params.text,
  });

  if (!gate.allowed) {
    return {
      ok: false,
      error: gate.reason ?? 'Blocked by Privacy Gate.',
      code: gate.code ?? 'PRIVACY_GATE_BLOCKED',
      privacyBlocked: true,
    };
  }

  try {
    const res = await fetch('/api/ai/reminders/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text,
        locale: params.locale,
        nowLocalIso: params.nowLocalIso,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: json.error || 'Could not parse reminder sentence.',
        code: json.code || 'AI_PARSE_ERROR',
        privacyBlocked: Boolean(json.privacyBlocked),
      };
    }

    return {
      ok: true,
      data: json.data as ParsedReminderDraft,
      meta: json.meta,
    };
  } catch {
    return {
      ok: false,
      error: 'Offline or network unavailable. Create your reminder manually below.',
      code: 'OFFLINE_ERROR',
    };
  }
}
