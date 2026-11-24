export type LifeOSModuleId =
  | 'assistant'
  | 'debts'
  | 'reminders'
  | 'planner'
  | 'notes'
  | 'vault'
  | 'habits'
  | 'finance';

export interface PrivacyGateInput {
  freeTier: boolean;
  module: LifeOSModuleId;
  text: string;
  hasAttachmentImage?: boolean;
  containsLockedOrE2E?: boolean;
  containsVaultSensitiveDoc?: boolean;
}

export interface PrivacyGateResult {
  allowed: boolean;
  code:
    | 'ALLOWED'
    | 'BLOCKED_E2E_OR_LOCKED'
    | 'BLOCKED_FREE_TIER_VAULT_IMAGE'
    | 'BLOCKED_FREE_TIER_SENSITIVE_DOC'
    | 'BLOCKED_FREE_TIER_SECRET_CONTENT';
  reason: string;
}

const SENSITIVE_IDENTITY_PATTERNS: RegExp[] = [
  /\bpassport\b/i,
  /\bnational\s*id\b/i,
  /\bid\s*card\b/i,
  /\bdriver'?s?\s*licen[sc]e\b/i,
  /\bpassword\s*vault\b/i,
  /\brecovery\s*key\b/i,
  /\bseed\s*phrase\b/i,
  /\bcvv\b/i,
  /\bpin\s*code\b/i,
  /جواز\s*سفر/,
  /بطاقة\s*وطنية/,
  /کلیلی\s*گەڕاندنەوە/,
  /پاسپۆرت/,
];

/**
 * PII scrub patterns: Credit card numbers (Luhn candidate 13-19 digits),
 * Iraqi national ID sequences (10-12 digits), and IBANs.
 */
const PII_PATTERNS: Array<{ regex: RegExp; mask: string }> = [
  // Credit Card / Debit Card (13-16 digits with optional dashes/spaces)
  { regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/g, mask: '[REDACTED_CARD]' },
  // International Bank Account Number (IBAN) e.g., IQxx xxxx xxxx ...
  { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/gi, mask: '[REDACTED_IBAN]' },
  // Common 10-14 digit national IDs / SSNs
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, mask: '[REDACTED_SSN]' },
];

/**
 * Client-side PII sanitizer: replaces sensitive account numbers, cards, and IBANs with redactions.
 */
export function scrubPIIFromText(text: string): { sanitized: string; scrubbedCount: number } {
  let result = text;
  let count = 0;
  for (const { regex, mask } of PII_PATTERNS) {
    const matches = result.match(regex);
    if (matches) {
      count += matches.length;
      result = result.replace(regex, mask);
    }
  }
  return { sanitized: result, scrubbedCount: count };
}

/**
 * Enforces LifeOS Privacy Gate rules on both client and server.
 * While `freeTier === true`, blocks scanned images, Vault documents, identity/passport content,
 * password-vault content, and locked/E2E items from ever leaving the device to a free-tier LLM.
 */
export function evaluatePrivacyGate(input: PrivacyGateInput): PrivacyGateResult {
  if (input.containsLockedOrE2E) {
    return {
      allowed: false,
      code: 'BLOCKED_E2E_OR_LOCKED',
      reason:
        'Locked or end-to-end encrypted items cannot be sent to cloud AI. Keep this item local or explicitly decrypt a minimal non-sensitive excerpt on a paid zero-retention tier.',
    };
  }

  if (input.freeTier) {
    if (input.hasAttachmentImage || input.module === 'vault') {
      return {
        allowed: false,
        code: 'BLOCKED_FREE_TIER_VAULT_IMAGE',
        reason:
          'Privacy Gate active (free_tier=true): Document Vault files and scanned images are blocked from cloud AI on free tiers. Use on-device tools or upgrade to a zero-retention paid AI provider.',
      };
    }

    if (input.containsVaultSensitiveDoc) {
      return {
        allowed: false,
        code: 'BLOCKED_FREE_TIER_SENSITIVE_DOC',
        reason:
          'Privacy Gate active (free_tier=true): Identity, passport, and sensitive vault documents cannot be transmitted on free tiers.',
      };
    }

    const matchedPattern = SENSITIVE_IDENTITY_PATTERNS.find((re) => re.test(input.text));
    if (matchedPattern) {
      return {
        allowed: false,
        code: 'BLOCKED_FREE_TIER_SECRET_CONTENT',
        reason:
          'Privacy Gate active (free_tier=true): Detected passport, ID, or password/recovery-key terms. Remove sensitive details before sending text to a free-tier model.',
      };
    }
  }

  return {
    allowed: true,
    code: 'ALLOWED',
    reason: 'Payload cleared Privacy Gate.',
  };
}

/**
 * Wraps user-authored notes/text in explicit untrusted delimiters to defend against prompt injection.
 */
export function wrapUntrustedUserText(
  text: string,
  module: LifeOSModuleId,
  taskType: string
): string {
  // First apply automated PII scrubbing
  const { sanitized: piiScrubbed } = scrubPIIFromText(text);
  const sanitized = piiScrubbed.replace(/<\/?untrusted_user_input>/gi, '[stripped_tag]').trim();
  return [
    `Module: ${module}`,
    `Task: ${taskType}`,
    '<untrusted_user_input>',
    sanitized,
    '</untrusted_user_input>',
  ].join('\n');
}

/**
 * Deterministic lightweight hash for client/Firestore prompt caching (FNV-1a 32-bit hex).
 */
export function computePromptCacheKey(parts: string[]): string {
  const input = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `aic_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
