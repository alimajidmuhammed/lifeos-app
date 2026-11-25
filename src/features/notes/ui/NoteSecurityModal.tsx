import React, { useState } from 'react';
import { Check, Copy, KeyRound, Lock, ShieldCheck, X } from 'lucide-react';
import { ModalPortal } from '../../../components/ModalPortal';

interface NoteSecurityModalProps {
  open: boolean;
  e2eConfigured: boolean;
  onClose: () => void;
  onInitializeE2E: (passphrase: string) => Promise<string>;
  onUnlockSession: (passphrase: string) => Promise<boolean>;
  onUnlockedSuccess?: () => void;
}

export const NoteSecurityModal: React.FC<NoteSecurityModalProps> = ({
  open,
  e2eConfigured,
  onClose,
  onInitializeE2E,
  onUnlockSession,
  onUnlockedSuccess,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleClose = () => {
    setPassphrase('');
    setConfirmPassphrase('');
    setRecoveryKey(null);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (passphrase.trim().length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      if (!e2eConfigured) {
        if (passphrase !== confirmPassphrase) {
          setError('Passphrases do not match.');
          setBusy(false);
          return;
        }
        const keyStr = await onInitializeE2E(passphrase);
        setRecoveryKey(keyStr);
      } else {
        const ok = await onUnlockSession(passphrase);
        if (!ok) {
          setError('Incorrect E2E passphrase. Try again.');
          setBusy(false);
          return;
        }
        setPassphrase('');
        onUnlockedSuccess?.();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Encryption error.');
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  return (
    <ModalPortal onClose={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={e2eConfigured ? 'Unlock E2E Notes Vault' : 'Enable Opt-In E2E Encryption'}
        className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
        onClick={handleClose}
      >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-md rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:max-h-[90dvh] anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hairline)]">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {recoveryKey
                ? 'Save Your Recovery Key'
                : e2eConfigured
                  ? 'Unlock Encrypted Notes'
                  : 'Set Up Opt-In E2E Encryption'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {recoveryKey ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                  <ShieldCheck className="h-4 w-4" />
                  <span>AES-256-GCM Zero-Knowledge Active</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Store this Recovery Key offline. Your passphrase never leaves this device and cannot be recovered by LifeinOne or Firebase.
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2.5">
                  <code className="font-numeric text-xs font-semibold text-[var(--text-primary)] break-all">
                    {recoveryKey}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyRecovery()}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                    aria-label="Copy recovery key"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onUnlockedSuccess?.();
                  handleClose();
                }}
                className="w-full min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                I Saved My Recovery Key · Continue
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {e2eConfigured
                  ? 'Enter your E2E passphrase to decrypt locked notes in memory for this session. AI features are strictly disabled on locked notes.'
                  : 'Create an opt-in AES-256-GCM passphrase (min 8 chars) to encrypt locked notes on-device before syncing to Cloud Firestore.'}
              </p>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Vault Passphrase
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {!e2eConfigured && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Confirm Passphrase
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Re-enter passphrase"
                    className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              )}

              {error && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
                <button
                  type="button"
                  onClick={handleClose}
                  className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>{busy ? '...' : e2eConfigured ? 'Unlock Session' : 'Enable AES-256-GCM'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};
