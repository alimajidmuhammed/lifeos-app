import { z } from 'zod';
import type { CurrencyCode, SupportedLocale } from '../currency/currency';
import {
  ALL_TRANSACTION_CATEGORIES,
  FINANCE_ACCOUNTS,
} from '../finance/financeSchemas';
import {
  executeWorkspaceAiTool,
  type WorkspaceSnapshot,
} from '../search/globalSearchEngine';
import { evaluatePrivacyGate } from './privacyGate';

export const ParsedTransactionDraftSchema = z.object({
  type: z.enum(['income', 'expense']),
  amountMajor: z.number().positive(),
  currency: z.enum(['IQD', 'USD', 'EUR']),
  category: z.enum(ALL_TRANSACTION_CATEGORIES).default('other'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.enum(FINANCE_ACCOUNTS).default('cash'),
  merchant: z.string().max(120).nullable().optional().default(null),
  note: z.string().max(500).nullable().optional().default(null),
});

export type ParsedTransactionDraft = z.infer<typeof ParsedTransactionDraftSchema>;

export const ProposedToolActionSchema = z.object({
  requiresConfirmation: z.literal(true),
  module: z.enum(['planner', 'reminders', 'habits', 'finance']),
  actionType: z.enum(['create_task', 'create_reminder', 'create_habit', 'create_transaction']),
  title: z.string().min(1).max(160),
  details: z.string().max(400),
  payload: z.record(z.string(), z.unknown()),
});

export type ProposedToolAction = z.infer<typeof ProposedToolActionSchema>;

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
}

export type GlobalAssistantResult =
  | {
      ok: true;
      answer: string;
      toolsInvoked: ToolCallTrace[];
      proposedAction: ProposedToolAction | null;
      meta: {
        modelUsed: string;
        latencyMs: number;
        inputTokensEst: number;
        outputTokensEst: number;
      };
    }
  | {
      ok: false;
      privacyBlocked?: boolean;
      code: string;
      error: string;
    };

export async function parseFinanceSentence(params: {
  text: string;
  locale: SupportedLocale;
  defaultCurrency: CurrencyCode;
  todayYmd: string;
  freeTier: boolean;
}): Promise<
  | { ok: true; data: ParsedTransactionDraft; meta: { modelUsed: string; inputTokensEst: number; outputTokensEst: number } }
  | { ok: false; privacyBlocked?: boolean; error: string }
> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: 'finance',
    text: params.text,
  });
  if (!gate.allowed) {
    return { ok: false, privacyBlocked: true, error: gate.reason };
  }

  try {
    const res = await fetch('/api/ai/finance/parse', {
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
        error: String(body.error ?? 'Could not parse transaction.'),
      };
    }
    const parsed = ParsedTransactionDraftSchema.safeParse(body.data);
    if (!parsed.success) {
      return { ok: false, error: 'AI returned an invalid transaction draft.' };
    }
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: parsed.data,
      meta: {
        modelUsed: String(meta.modelUsed ?? 'gemini-4-hydrogen'),
        inputTokensEst: Number(meta.inputTokensEst ?? 0),
        outputTokensEst: Number(meta.outputTokensEst ?? 0),
      },
    };
  } catch {
    return { ok: false, error: 'Unable to reach AI service. Enter the transaction manually offline.' };
  }
}

/**
 * Runs the 2-phase Gemini Function Calling assistant loop:
 * 1) Sends user query to `/api/ai/assistant/tools` (after Privacy Gate).
 * 2) If Gemini emits read-only tool calls, executes them deterministically on-device
 *    against `snapshot` (keeping Vault scans and locked notes off cloud AI) and posts
 *    tool results back for final synthesis + optional confirmation-gated action.
 */
export async function runGlobalToolAssistant(params: {
  query: string;
  locale: SupportedLocale;
  snapshot: WorkspaceSnapshot;
  freeTier: boolean;
  simulateVaultImage?: boolean;
  simulateLockedNote?: boolean;
}): Promise<GlobalAssistantResult> {
  const gate = evaluatePrivacyGate({
    freeTier: params.freeTier,
    module: params.simulateVaultImage ? 'vault' : 'assistant',
    text: params.query,
    hasAttachmentImage: params.simulateVaultImage,
    containsLockedOrE2E: params.simulateLockedNote,
    containsVaultSensitiveDoc: params.simulateVaultImage,
  });

  if (!gate.allowed) {
    return {
      ok: false,
      privacyBlocked: true,
      code: gate.code,
      error: gate.reason,
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      code: 'OFFLINE',
      error: 'You are offline. Instant cross-module search above continues working locally.',
    };
  }

  const startedAt = Date.now();
  try {
    // Phase 1: Initial Gemini tool-selection call
    const res1 = await fetch('/api/ai/assistant/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: params.query,
        locale: params.locale,
        todayYmd: params.snapshot.todayYmd,
        primaryCurrency: params.snapshot.primaryCurrency,
      }),
    });
    const body1 = (await res1.json()) as Record<string, unknown>;
    if (!res1.ok) {
      return {
        ok: false,
        privacyBlocked: Boolean(body1.privacyBlocked),
        code: String(body1.code ?? 'HTTP_ERROR'),
        error: String(body1.error ?? 'AI assistant failed.'),
      };
    }

    const toolCalls = Array.isArray(body1.toolCalls)
      ? (body1.toolCalls as Array<{ id?: string; name: string; args?: Record<string, unknown> }>)
      : [];

    const readToolNames = new Set([
      'search_workspace',
      'get_financial_snapshot',
      'get_habit_consistency',
      'get_upcoming_commitments',
    ]);

    const readCalls = toolCalls.filter((tc) => readToolNames.has(tc.name));
    const proposeCall = toolCalls.find((tc) => tc.name === 'propose_workspace_action');

    const traced: ToolCallTrace[] = toolCalls.map((tc) => ({
      name: tc.name,
      args: tc.args ?? {},
    }));

    let proposedAction: ProposedToolAction | null = null;
    if (proposeCall?.args) {
      const candidate = normalizeProposedAction(proposeCall.args);
      if (candidate) proposedAction = candidate;
    }

    // If Gemini requested read-only tools, execute them deterministically on-device & run Phase 2 synthesis
    if (readCalls.length > 0) {
      const toolResults = readCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        response: executeWorkspaceAiTool(tc.name, tc.args ?? {}, params.snapshot),
      }));

      const res2 = await fetch('/api/ai/assistant/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: params.query,
          locale: params.locale,
          todayYmd: params.snapshot.todayYmd,
          primaryCurrency: params.snapshot.primaryCurrency,
          toolResults,
        }),
      });
      const body2 = (await res2.json()) as Record<string, unknown>;
      if (res2.ok) {
        const meta2 = (body2.meta ?? {}) as Record<string, unknown>;
        if (!proposedAction && body2.proposedAction) {
          const parsedAct = ProposedToolActionSchema.safeParse(body2.proposedAction);
          if (parsedAct.success) proposedAction = parsedAct.data;
        }
        return {
          ok: true,
          answer: String(body2.answer ?? 'Completed workspace lookup.'),
          toolsInvoked: traced,
          proposedAction,
          meta: {
            modelUsed: String(meta2.modelUsed ?? 'gemini-4-hydrogen'),
            latencyMs: Date.now() - startedAt,
            inputTokensEst: Number(meta2.inputTokensEst ?? 0),
            outputTokensEst: Number(meta2.outputTokensEst ?? 0),
          },
        };
      }
    }

    const meta1 = (body1.meta ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      answer:
        String(body1.answer ?? '').trim() ||
        (proposedAction
          ? `Prepared a confirmation draft to ${proposedAction.title}. Review and confirm below.`
          : 'Done.'),
      toolsInvoked: traced,
      proposedAction,
      meta: {
        modelUsed: String(meta1.modelUsed ?? 'gemini-4-hydrogen'),
        latencyMs: Date.now() - startedAt,
        inputTokensEst: Number(meta1.inputTokensEst ?? 0),
        outputTokensEst: Number(meta1.outputTokensEst ?? 0),
      },
    };
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      error: 'Unable to reach AI assistant. Instant local search remains available.',
    };
  }
}

function normalizeProposedAction(args: Record<string, unknown>): ProposedToolAction | null {
  const mod = String(args.module ?? '');
  const actionType = String(args.actionType ?? '');
  const title = String(args.title ?? '').trim().slice(0, 160);
  const details = String(args.details ?? '').trim().slice(0, 400);
  let payloadObj: Record<string, unknown> = {};
  if (typeof args.structuredDraftJson === 'string') {
    try {
      const parsed = JSON.parse(args.structuredDraftJson);
      if (parsed && typeof parsed === 'object') payloadObj = parsed as Record<string, unknown>;
    } catch {
      payloadObj = {};
    }
  } else if (args.payload && typeof args.payload === 'object') {
    payloadObj = args.payload as Record<string, unknown>;
  }

  const parsed = ProposedToolActionSchema.safeParse({
    requiresConfirmation: true,
    module: mod,
    actionType,
    title: title || 'Workspace Action',
    details: details || 'Review before applying to your workspace.',
    payload: payloadObj,
  });
  return parsed.success ? parsed.data : null;
}
