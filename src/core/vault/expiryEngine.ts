import type { CreateReminderInput } from '../reminders/reminderSchemas';
import type { VaultDocumentMeta } from './vaultSchemas';

export type ExpiryStatus = 'expired' | 'critical' | 'soon' | 'valid' | 'no_expiry';

export interface DocumentExpiryEvaluation {
  status: ExpiryStatus;
  daysRemaining: number | null;
  label: string;
}

function parseYmdUtcMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Deterministic, timezone-safe expiry evaluation comparing YYYY-MM-DD dates in UTC whole days.
 */
export function evaluateDocumentExpiry(
  expiryDate: string | undefined,
  todayYmd: string
): DocumentExpiryEvaluation {
  if (!expiryDate) {
    return { status: 'no_expiry', daysRemaining: null, label: 'No expiry' };
  }
  const expMs = parseYmdUtcMs(expiryDate);
  const todayMs = parseYmdUtcMs(todayYmd);
  if (expMs === null || todayMs === null) {
    return { status: 'no_expiry', daysRemaining: null, label: 'No expiry' };
  }

  const days = Math.round((expMs - todayMs) / 86_400_000);
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      status: 'expired',
      daysRemaining: days,
      label: `Expired ${overdue}d ago`,
    };
  }
  if (days === 0) {
    return { status: 'critical', daysRemaining: 0, label: 'Expires today' };
  }
  if (days <= 30) {
    return { status: 'critical', daysRemaining: days, label: `Expires in ${days}d` };
  }
  if (days <= 90) {
    return { status: 'soon', daysRemaining: days, label: `Expires in ${days}d` };
  }
  return { status: 'valid', daysRemaining: days, label: `Valid · ${days}d left` };
}

export interface VaultExpirySummary {
  totalDocs: number;
  expiredCount: number;
  expiring30Count: number;
  expiring90Count: number;
  encryptedCount: number;
  totalBytes: number;
}

export function computeVaultSummary(
  docs: VaultDocumentMeta[],
  todayYmd: string
): VaultExpirySummary {
  let expiredCount = 0;
  let expiring30Count = 0;
  let expiring90Count = 0;
  let encryptedCount = 0;
  let totalBytes = 0;

  for (const doc of docs) {
    totalBytes += doc.sizeBytes;
    if (doc.isEncrypted) encryptedCount += 1;
    const ev = evaluateDocumentExpiry(doc.expiryDate, todayYmd);
    if (ev.status === 'expired') expiredCount += 1;
    else if (ev.status === 'critical') {
      expiring30Count += 1;
      expiring90Count += 1;
    } else if (ev.status === 'soon') {
      expiring90Count += 1;
    }
  }

  return {
    totalDocs: docs.length,
    expiredCount,
    expiring30Count,
    expiring90Count,
    encryptedCount,
    totalBytes,
  };
}

/**
 * Generates a deterministic Smart Reminder draft (Phase 3 Reminder engine compatible)
 * scheduled `leadDays` before a document's expiry date at 09:00 UTC (clamped to tomorrow if already past).
 */
export function buildExpiryReminderInput(
  doc: VaultDocumentMeta,
  todayYmd: string,
  leadDays = 30
): CreateReminderInput | null {
  if (!doc.expiryDate) return null;
  const expMs = parseYmdUtcMs(doc.expiryDate);
  const todayMs = parseYmdUtcMs(todayYmd);
  if (expMs === null || todayMs === null) return null;

  const targetMs = expMs - leadDays * 86_400_000;
  const minMs = todayMs + 86_400_000; // tomorrow if lead window already passed
  const fireDate = new Date(Math.max(targetMs, minMs));
  fireDate.setUTCHours(9, 0, 0, 0);

  return {
    title: `Renew ${doc.title} (expires ${doc.expiryDate})`,
    notes: [
      `Vault document expiry alert (${doc.docType}).`,
      doc.issuer ? `Issuer: ${doc.issuer}` : '',
      doc.documentNumberLast4 ? `Ref ending: •••• ${doc.documentNumberLast4}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    category: 'expiry',
    priority: targetMs <= todayMs ? 'urgent' : 'high',
    dueAtIso: fireDate.toISOString(),
    respectQuietHours: true,
  };
}
