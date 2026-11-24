import { z } from 'zod';
import {
  computePromptCacheKey,
  evaluatePrivacyGate,
  type LifeOSModuleId,
} from './privacyGate';
import type { SupportedLocale } from '../currency/currency';

export interface AIRequestPayload {
  module: LifeOSModuleId;
  taskType: 'briefing' | 'parse' | 'explain' | 'draft' | 'classify';
  text: string;
  locale: SupportedLocale;
  hasAttachmentImage?: boolean;
  containsLockedOrE2E?: boolean;
  containsVaultSensitiveDoc?: boolean;
  tier?: 'primary' | 'lite';
}

export const SuggestedActionSchema = z.object({
  requiresConfirmation: z.boolean(),
  module: z.enum(['debts', 'reminders', 'planner', 'notes', 'habits', 'finance', 'none']),
  actionType: z.string(),
  title: z.string(),
  details: z.string(),
});

export const AIResponseDataSchema = z.object({
  summary: z.string(),
  suggestedAction: SuggestedActionSchema.nullable().optional().default(null),
  safetyNote: z.string().nullable().optional().default(null),
});

export type AIResponseData = z.infer<typeof AIResponseDataSchema>;

export interface AIExecutionMeta {
  modelUsed: string;
  promptVersion: string;
  latencyMs: number;
  freeTier: boolean;
  cached: boolean;
  inputTokensEst: number;
  outputTokensEst: number;
}

export type AIResult =
  | {
      ok: true;
      data: AIResponseData;
      meta: AIExecutionMeta;
    }
  | {
      ok: false;
      privacyBlocked?: boolean;
      code: string;
      error: string;
    };

export interface AIRuntimeStatus {
  provider: string;
  primaryModel: string;
  liteModel: string;
  freeTier: boolean;
  promptVersion: string;
  configured: boolean;
}

/**
 * Provider-agnostic AI interface so Stage 1 can swap from Firebase AI Logic / Express proxy
 * to Cloud Functions (Vertex AI / Claude / OpenAI) with zero UI changes.
 */
export interface LLMProvider {
  getRuntimeStatus(): Promise<AIRuntimeStatus>;
  complete(payload: AIRequestPayload, freeTier: boolean): Promise<AIResult>;
}

const memoryCache = new Map<string, { data: AIResponseData; meta: AIExecutionMeta; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export class ServerProxyLLMProvider implements LLMProvider {
  async getRuntimeStatus(): Promise<AIRuntimeStatus> {
    try {
      const res = await fetch('/api/ai/config');
      if (!res.ok) throw new Error('Failed to fetch AI config');
      return (await res.json()) as AIRuntimeStatus;
    } catch {
      return {
        provider: 'offline-fallback',
        primaryModel: 'gemini-4-hydrogen',
        liteModel: 'gemini-3.1-flash-lite',
        freeTier: true,
        promptVersion: 'lifeos-v1.0',
        configured: false,
      };
    }
  }

  async complete(payload: AIRequestPayload, freeTier: boolean): Promise<AIResult> {
    // 1. Client-side Privacy Gate pre-flight (prevents sensitive bytes from even leaving browser)
    const gate = evaluatePrivacyGate({
      freeTier,
      module: payload.module,
      text: payload.text,
      hasAttachmentImage: payload.hasAttachmentImage,
      containsLockedOrE2E: payload.containsLockedOrE2E,
      containsVaultSensitiveDoc: payload.containsVaultSensitiveDoc,
    });

    if (!gate.allowed) {
      return {
        ok: false,
        privacyBlocked: true,
        code: gate.code,
        error: gate.reason,
      };
    }

    // 2. Offline check
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        ok: false,
        code: 'OFFLINE',
        error: 'You are currently offline. Cloud AI is paused while all offline LifeOS features stay available.',
      };
    }

    // 3. Deterministic prompt cache lookup
    const cacheKey = computePromptCacheKey([
      'lifeos-v1.0',
      payload.locale,
      payload.module,
      payload.taskType,
      payload.tier ?? 'primary',
      payload.text.trim(),
    ]);
    const hit = memoryCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return {
        ok: true,
        data: hit.data,
        meta: { ...hit.meta, cached: true, latencyMs: 1 },
      };
    }

    // 4. Network request with exponential backoff on 429
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch('/api/ai/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const body = (await response.json()) as Record<string, unknown>;

        if (response.status === 429 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          continue;
        }

        if (!response.ok) {
          return {
            ok: false,
            privacyBlocked: Boolean(body.privacyBlocked),
            code: String(body.code ?? 'HTTP_ERROR'),
            error: String(body.error ?? 'AI request failed.'),
          };
        }

        const parsed = AIResponseDataSchema.safeParse(body.data);
        if (!parsed.success) {
          return {
            ok: false,
            code: 'INVALID_AI_SCHEMA',
            error: 'Received malformed structured output from AI provider.',
          };
        }

        const metaObj = (body.meta ?? {}) as Record<string, unknown>;
        const meta: AIExecutionMeta = {
          modelUsed: String(metaObj.modelUsed ?? 'gemini-4-hydrogen'),
          promptVersion: String(metaObj.promptVersion ?? 'lifeos-v1.0'),
          latencyMs: Number(metaObj.latencyMs ?? 0),
          freeTier: Boolean(metaObj.freeTier ?? freeTier),
          cached: false,
          inputTokensEst: Number(metaObj.inputTokensEst ?? 0),
          outputTokensEst: Number(metaObj.outputTokensEst ?? 0),
        };

        memoryCache.set(cacheKey, {
          data: parsed.data,
          meta,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });

        return { ok: true, data: parsed.data, meta };
      } catch {
        if (attempt >= maxAttempts) {
          return {
            ok: false,
            code: 'NETWORK_ERROR',
            error: 'Unable to reach LifeOS AI service. Non-AI tools remain fully functional.',
          };
        }
      }
    }

    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      error: 'AI service temporarily unavailable.',
    };
  }
}

export const defaultLLMProvider: LLMProvider = new ServerProxyLLMProvider();
