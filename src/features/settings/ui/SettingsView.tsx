import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Download,
  Fingerprint,
  Globe,
  KeyRound,
  LayoutTemplate,
  Lock,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  Type,
  Unlock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  bootstrapE2EVault,
  decryptText,
  deriveAesKeyFromSecret,
  encryptText,
  verifyE2EPassphrase,
} from '../../../core/crypto/e2eCrypto';
import type { CurrencyCode, SupportedLocale } from '../../../core/currency/currency';
import { DEFAULT_FEATURE_FLAGS } from '../../../core/entitlements/entitlements';
import type { AiModuleToggles } from '../../../core/schemas/userProfileSchema';
import { persistProfilePatch } from '../../../hooks/useLifeOS';
import { useUIStore, type ThemeMode } from '../../../state/useUIStore';
import { PWAInstallButton } from '../../../components/PWAInstallButton';
import {
  hasWebAuthnCredential,
  isWebAuthnSupported,
  registerWebAuthn,
  removeWebAuthnCredential,
} from '../../../core/auth/webauthn';

const AI_MODULES: Array<{ key: keyof AiModuleToggles; labelKey: string; lockedOnFreeTier?: boolean }> = [
  { key: 'assistant', labelKey: 'common.quickAction' },
  { key: 'debts', labelKey: 'nav.debts' },
  { key: 'reminders', labelKey: 'nav.reminders' },
  { key: 'planner', labelKey: 'nav.planner' },
  { key: 'notes', labelKey: 'nav.notes' },
  { key: 'vault', labelKey: 'nav.vault', lockedOnFreeTier: true },
  { key: 'habits', labelKey: 'nav.habits' },
  { key: 'finance', labelKey: 'nav.finance' },
];

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const pinEnabled = useUIStore((s) => s.pinEnabled);
  const setTheme = useUIStore((s) => s.setTheme);
  const setLocale = useUIStore((s) => s.setLocale);
  const setCurrencies = useUIStore((s) => s.setCurrencies);
  const toggleAiModule = useUIStore((s) => s.toggleAiModule);
  const configurePinLock = useUIStore((s) => s.configurePinLock);
  const removePinLock = useUIStore((s) => s.removePinLock);
  const lockApp = useUIStore((s) => s.lockApp);
  const showToast = useUIStore((s) => s.showToast);

  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);
  const fontScale = useUIStore((s) => s.fontScale);
  const setFontScale = useUIStore((s) => s.setFontScale);

  // PIN form state
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Biometrics state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [webAuthnEnrolled, setWebAuthnEnrolled] = useState(false);
  const [webAuthnBusy, setWebAuthnBusy] = useState(false);

  useEffect(() => {
    setWebAuthnSupported(isWebAuthnSupported());
    setWebAuthnEnrolled(hasWebAuthnCredential());
  }, []);

  const handleEnrollBiometrics = async () => {
    setWebAuthnBusy(true);
    try {
      const ok = await registerWebAuthn();
      if (ok) {
        setWebAuthnEnrolled(true);
        showToast('Device Biometrics enrolled successfully.');
      } else {
        showToast('Biometric enrollment cancelled or not available.');
      }
    } catch {
      showToast('Biometric registration error.');
    } finally {
      setWebAuthnBusy(false);
    }
  };

  const handleRemoveBiometrics = () => {
    removeWebAuthnCredential();
    setWebAuthnEnrolled(false);
    showToast('Biometric credential removed.');
  };

  // E2E setup & verification state
  const [passphrase, setPassphrase] = useState('');
  const [e2eError, setE2eError] = useState('');
  const [recoveryKeyDisplay, setRecoveryKeyDisplay] = useState<string | null>(null);
  const [roundTripStatus, setRoundTripStatus] = useState<string | null>(null);
  const [e2eBusy, setE2eBusy] = useState(false);

  const handleThemeSelect = (mode: ThemeMode) => {
    setTheme(mode);
    void persistProfilePatch({ theme: mode });
  };

  const handleLocaleSelect = (loc: SupportedLocale) => {
    setLocale(loc);
    void persistProfilePatch({ locale: loc });
  };

  const handleCurrencyChange = (primary: CurrencyCode, secondary: CurrencyCode) => {
    setCurrencies(primary, secondary);
    void persistProfilePatch({ primaryCurrency: primary, secondaryCurrency: secondary });
  };

  const handlePinSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pinInput.trim();
    if (!/^\d{4,8}$/.test(cleaned)) {
      setPinError('PIN must be 4 to 8 digits.');
      return;
    }
    configurePinLock(cleaned);
    setPinInput('');
    setPinError('');
    showToast('Local PIN App Lock enabled.');
  };

  const handleE2ESetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setE2eError('');
    setRoundTripStatus(null);
    if (passphrase.trim().length < 8) {
      setE2eError('Passphrase must be at least 8 characters.');
      return;
    }
    setE2eBusy(true);
    try {
      const setup = await bootstrapE2EVault(passphrase);
      setRecoveryKeyDisplay(setup.recoveryKey);
      await persistProfilePatch({
        e2eConfigured: true,
        e2eSalt: setup.salt,
        e2eVerifier: setup.verifier,
      });
      showToast('Opt-in AES-256-GCM E2E vault initialized. Save your Recovery Key offline.');
    } catch (err) {
      setE2eError(err instanceof Error ? err.message : 'Failed to initialize E2E encryption.');
    } finally {
      setE2eBusy(false);
    }
  };

  const handleVerifyE2ERoundTrip = async () => {
    if (!profile.e2eSalt || !profile.e2eVerifier || !passphrase) {
      setE2eError('Enter your E2E passphrase above to run a live encrypt/decrypt check.');
      return;
    }
    setE2eBusy(true);
    setE2eError('');
    try {
      const valid = await verifyE2EPassphrase(passphrase, profile.e2eSalt, profile.e2eVerifier);
      if (!valid) {
        setE2eError('Passphrase did not match stored verifier.');
        setRoundTripStatus(null);
        return;
      }
      const key = await deriveAesKeyFromSecret(passphrase, profile.e2eSalt);
      const sample = 'LifeOS AES-256-GCM self-test passed';
      const encrypted = await encryptText(sample, key);
      const decrypted = await decryptText(encrypted, key);
      if (decrypted === sample) {
        setRoundTripStatus(`Verified: AES-256-GCM ciphertext (${encrypted.ct.slice(0, 18)}...) decrypted cleanly.`);
      }
    } finally {
      setE2eBusy(false);
    }
  };

  const handleExportJson = () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      account: authUser ? { uid: authUser.uid, email: authUser.email } : { mode: 'local_offline' },
      profile,
      entitlements,
      featureFlags: DEFAULT_FEATURE_FLAGS,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifeos-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Workspace JSON exported.');
  };

  const toggles = profile.aiModuleToggles ?? {
    debts: true,
    reminders: true,
    planner: true,
    notes: true,
    vault: false,
    habits: true,
    finance: true,
    assistant: true,
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {t('settings.title')}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* 1. Theme & Language (RTL) */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('settings.appearanceTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {t('settings.appearanceDesc')}
            </p>
          </div>
          <div
            role="group"
            aria-label={t('settings.appearanceTitle')}
            className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-subtle)] p-1"
          >
            {(
              [
                { id: 'light', label: t('settings.light'), icon: Sun },
                { id: 'dark', label: t('settings.dark'), icon: Moon },
                { id: 'amoled', label: t('settings.amoled'), icon: Smartphone },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = profile.theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleThemeSelect(opt.id)}
                  className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Density Mode */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-[var(--accent)]" />
              <span>Display Density</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Choose between comfortable touch targets (56px) and high-density spreadsheet view (36px).
            </p>
          </div>
          <div
            role="group"
            aria-label="Display Density"
            className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-subtle)] p-1"
          >
            {(
              [
                { id: 'comfortable', label: 'Comfortable (56px)' },
                { id: 'compact', label: 'Compact (36px)' },
              ] as const
            ).map((opt) => {
              const active = density === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDensity(opt.id)}
                  className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Font Size Scale (85% to 125%) */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Type className="h-4 w-4 text-[var(--accent)]" />
              <span>Font Scale ({fontScale}%)</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Adjust typography size safely across LifeOS without distorting layouts or breaking touch targets.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-64">
            <span className="text-xs font-numeric text-[var(--text-muted)] shrink-0">85%</span>
            <input
              type="range"
              min="85"
              max="125"
              step="5"
              value={fontScale}
              onChange={(e) => setFontScale(Number(e.target.value))}
              aria-label="Font scale slider"
              className="w-full accent-emerald-600 cursor-pointer h-2 bg-[var(--bg-subtle)] rounded-lg"
            />
            <span className="text-xs font-numeric text-[var(--text-muted)] shrink-0">125%</span>
          </div>
        </div>

        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--accent)]" />
              <span>{t('settings.languageTitle')}</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {t('settings.languageDesc')}
            </p>
          </div>
          <div
            role="group"
            aria-label={t('settings.languageTitle')}
            className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-subtle)] p-1"
          >
            {(
              [
                { id: 'en', label: 'English (LTR)' },
                { id: 'ar', label: 'العربية (RTL)' },
                { id: 'ckb', label: 'کوردی (RTL)' },
              ] as const
            ).map((lang) => {
              const active = profile.locale === lang.id;
              return (
                <button
                  key={lang.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleLocaleSelect(lang.id)}
                  className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {lang.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="primary-currency-select"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              {t('home.primaryCurrency')}
            </label>
            <select
              id="primary-currency-select"
              value={profile.primaryCurrency}
              onChange={(e) =>
                handleCurrencyChange(e.target.value as CurrencyCode, profile.secondaryCurrency)
              }
              className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="IQD">IQD — Iraqi Dinar</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="secondary-currency-select"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              {t('home.secondaryCurrency')}
            </label>
            <select
              id="secondary-currency-select"
              value={profile.secondaryCurrency}
              onChange={(e) =>
                handleCurrencyChange(profile.primaryCurrency, e.target.value as CurrencyCode)
              }
              className="mt-1.5 min-h-[42px] w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="USD">USD — US Dollar</option>
              <option value="IQD">IQD — Iraqi Dinar</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>
        </div>
      </section>

      {/* 2. AI Privacy Gate & Module Toggles */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
              <span>{t('settings.aiPrivacyTitle')}</span>
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {t('settings.aiFreeTierNotice')}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={profile.aiGlobalEnabled}
              onChange={(e) => {
                void persistProfilePatch({ aiGlobalEnabled: e.target.checked });
                showToast(e.target.checked ? 'AI enabled across selected modules.' : 'AI disabled globally.');
              }}
              className="h-4 w-4 rounded accent-emerald-600"
            />
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {profile.aiGlobalEnabled ? t('settings.aiOn') : t('settings.aiOff')}
            </span>
          </label>
        </div>

        <div className="pt-4 border-t border-[var(--border-hairline)]">
          <div className="text-xs font-medium text-[var(--text-muted)] mb-3">
            {t('settings.aiModuleTogglesTitle')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {AI_MODULES.map((m) => {
              const checked = Boolean(toggles[m.key]) && !m.lockedOnFreeTier;
              return (
                <label
                  key={m.key}
                  className={`min-h-[44px] flex items-center justify-between gap-3 rounded-xl border border-[var(--border-hairline)] px-3.5 py-2 text-xs ${
                    m.lockedOnFreeTier
                      ? 'bg-[var(--bg-subtle)]/50 text-[var(--text-muted)] cursor-not-allowed'
                      : 'bg-[var(--bg-canvas)] text-[var(--text-primary)] cursor-pointer'
                  }`}
                >
                  <span>
                    {t(m.labelKey)}
                    {m.lockedOnFreeTier ? ` (${t('settings.blockedFreeTier')})` : ''}
                  </span>
                  <input
                    type="checkbox"
                    disabled={m.lockedOnFreeTier || !profile.aiGlobalEnabled}
                    checked={checked}
                    onChange={(e) => {
                      toggleAiModule(m.key, e.target.checked);
                      void persistProfilePatch({
                        aiModuleToggles: { ...toggles, [m.key]: e.target.checked },
                      });
                    }}
                    className="h-4 w-4 accent-emerald-600"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Device PIN Lock & Opt-In AES-256-GCM E2E Encryption */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
        {/* PIN Lock */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Lock className="h-4 w-4 text-[var(--accent)]" />
                <span>{t('settings.pinLockLabel')}</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {t('settings.pinDesc')}
              </p>
            </div>
            {pinEnabled && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={lockApp}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>{t('settings.pinLockNowBtn')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removePinLock();
                    showToast('Local PIN lock removed.');
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  <span>{t('settings.pinRemoveBtn')}</span>
                </button>
              </div>
            )}
          </div>

          {!pinEnabled && (
            <form onSubmit={handlePinSave} className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
              <div className="w-full sm:w-56">
                <label htmlFor="new-pin-input" className="block text-xs font-medium text-[var(--text-secondary)]">
                  {t('settings.pinInputLabel')}
                </label>
                <input
                  id="new-pin-input"
                  type="password"
                  inputMode="numeric"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError('');
                  }}
                  placeholder="1234"
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 font-numeric text-sm text-[var(--text-primary)]"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
              >
                {t('settings.pinSetBtn')}
              </button>
            </form>
          )}
          {pinError && <p className="text-xs text-red-600 dark:text-red-400">{pinError}</p>}
        </div>

        {/* WebAuthn Biometrics */}
        <div className="p-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-[var(--accent)]" />
                <span>Device Biometrics (WebAuthn)</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Unlock LifeOS using Touch ID, Face ID, or Windows Hello. Credentials remain strictly on-device.
              </p>
            </div>
            {webAuthnSupported ? (
              webAuthnEnrolled ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Enrolled</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveBiometrics}
                    className="min-h-[38px] rounded-xl border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={webAuthnBusy}
                  onClick={() => void handleEnrollBiometrics()}
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 btn-spring whitespace-nowrap"
                >
                  <Fingerprint className="h-4 w-4" />
                  <span>{webAuthnBusy ? 'Enrolling...' : 'Enable Biometrics'}</span>
                </button>
              )
            ) : (
              <span className="text-xs text-[var(--text-muted)]">Not supported on this browser</span>
            )}
          </div>
        </div>

        {/* Opt-In AES-256-GCM E2E */}
        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[var(--accent)]" />
              <span>{t('settings.e2eTitle')}</span>
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {t('settings.e2eDesc')}
            </p>
          </div>

          <form onSubmit={handleE2ESetup} className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="w-full sm:flex-1">
              <label htmlFor="e2e-passphrase-input" className="block text-xs font-medium text-[var(--text-secondary)]">
                {t('settings.e2ePassphraseLabel')}
              </label>
              <input
                id="e2e-passphrase-input"
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setE2eError('');
                }}
                placeholder="Enter a strong vault passphrase"
                className="mt-1 min-h-[42px] w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>
            <button
              type="submit"
              disabled={e2eBusy}
              className="min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {e2eBusy ? 'Deriving Key...' : t('settings.e2eSetupBtn')}
            </button>
            {profile.e2eConfigured && (
              <button
                type="button"
                disabled={e2eBusy}
                onClick={() => void handleVerifyE2ERoundTrip()}
                className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
              >
                {t('settings.e2eTestBtn')}
              </button>
            )}
          </form>

          {e2eError && <p className="text-xs text-red-600 dark:text-red-400">{e2eError}</p>}

          {recoveryKeyDisplay && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Save Your One-Time Recovery Key Offline
              </div>
              <div className="font-numeric text-sm font-semibold tracking-wider text-[var(--text-primary)] select-all">
                {recoveryKeyDisplay}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                LifeOS never stores this key or your passphrase. Store it safely outside your phone.
              </p>
            </div>
          )}

          {roundTripStatus && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-numeric">{roundTripStatus}</span>
            </div>
          )}
        </div>
      </section>

      {/* 4. Portability, PWA & Feature Flags */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-4">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('settings.accountTitle')}
        </h2>

        <p className="text-xs text-[var(--text-secondary)]">
          {t('settings.appleSignInFlag')}
        </p>

        <label className="inline-flex items-center gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={profile.analyticsConsent}
            onChange={(e) => {
              void persistProfilePatch({ analyticsConsent: e.target.checked });
              showToast('Analytics consent preference updated.');
            }}
            className="h-4 w-4 accent-emerald-600"
          />
          <span>{t('settings.analyticsConsentLabel')}</span>
        </label>

        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            <Download className="h-4 w-4 text-[var(--accent)]" />
            <span>{t('settings.exportJsonBtn')}</span>
          </button>
          <PWAInstallButton compact />
        </div>
      </section>

      {/* 5. Keyboard Shortcuts Reference */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('home.shortcutsTitle')}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {t('home.shortcutsDesc')}
        </p>
      </section>
    </div>
  );
};
