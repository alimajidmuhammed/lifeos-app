import React, { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state/useUIStore';
import { ModalPortal } from './ModalPortal';
import { authenticateWebAuthn, hasWebAuthnCredential, isBiometricAvailableAsync } from '../core/auth/webauthn';

export const AppLockOverlay: React.FC = () => {
  const { t } = useTranslation();
  const isAppLocked = useUIStore((s) => s.isAppLocked);
  const unlockApp = useUIStore((s) => s.unlockApp);
  const unlockAppDirect = useUIStore((s) => s.unlockAppDirect);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!isAppLocked || !hasWebAuthnCredential()) {
      setBiometricAvailable(false);
      return;
    }
    void isBiometricAvailableAsync().then((avail) => {
      if (mounted) setBiometricAvailable(avail);
    });
    return () => {
      mounted = false;
    };
  }, [isAppLocked]);

  const handleBiometricUnlock = useCallback(async () => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    setError('');
    try {
      const ok = await authenticateWebAuthn();
      if (ok) {
        unlockAppDirect();
        setPin('');
        setError('');
      } else {
        setError(t('lock.biometricFailed'));
      }
    } catch {
      setError(t('lock.biometricFailed'));
    } finally {
      setBiometricBusy(false);
    }
  }, [biometricBusy, unlockAppDirect, t]);

  // Auto-trigger biometric on mount if available
  useEffect(() => {
    if (isAppLocked && biometricAvailable) {
      void handleBiometricUnlock();
    }
    // Only trigger once on mount/lock state change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppLocked, biometricAvailable]);

  if (!isAppLocked) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = unlockApp(pin);
    if (ok) {
      setPin('');
      setError('');
    } else {
      setError(t('lock.wrongPin'));
      setPin('');
    }
  };

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('lock.title')}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--bg-canvas)]/95 p-6 backdrop-blur-md anim-modal-backdrop"
      >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 anim-modal-content"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-[var(--text-primary)]">{t('lock.title')}</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('lock.subtitle')}</p>

        {biometricAvailable && (
          <button
            type="button"
            disabled={biometricBusy}
            onClick={() => void handleBiometricUnlock()}
            className="mt-5 min-h-[52px] w-full flex items-center justify-center gap-2.5 rounded-xl border-2 border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/15 btn-spring transition-colors disabled:opacity-60"
          >
            <Fingerprint className="h-5 w-5" />
            <span>{biometricBusy ? t('lock.biometricVerifying') : t('lock.biometricBtn')}</span>
          </button>
        )}

        {biometricAvailable && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-[var(--border-hairline)]" />
            <span className="text-xs text-[var(--text-muted)]">{t('lock.orPin')}</span>
            <div className="flex-1 h-px bg-[var(--border-hairline)]" />
          </div>
        )}

        <div className={biometricAvailable ? 'mt-3' : 'mt-5'}>
          <label htmlFor="unlock-pin-input" className="block text-xs font-medium text-[var(--text-secondary)]">
            PIN
          </label>
          <input
            id="unlock-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={!biometricAvailable}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError('');
            }}
            placeholder="••••"
            className="mt-1.5 min-h-[44px] w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-numeric text-base tracking-widest text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <button
          type="submit"
          className="mt-5 min-h-[44px] w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] btn-spring transition-colors"
        >
          {t('lock.unlockBtn')}
        </button>
      </form>
    </div>
    </ModalPortal>
  );
};
