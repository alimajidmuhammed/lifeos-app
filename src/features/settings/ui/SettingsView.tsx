import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  Minus,
  Moon,
  Plus,
  ShieldCheck,
  Smartphone,
  Sun,
  Type,
  Unlock,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  bootstrapE2EVault,
  decryptText,
  deriveAesKeyFromSecret,
  encryptText,
  verifyE2EPassphrase,
} from '../../../core/crypto/e2eCrypto';
import {
  GLOBAL_CURRENCIES,
  getCurrencyMeta,
  type CurrencyCode,
  type SupportedLocale,
} from '../../../core/currency/currency';
import { DEFAULT_FEATURE_FLAGS } from '../../../core/entitlements/entitlements';
import type { AiModuleToggles } from '../../../core/schemas/userProfileSchema';
import { persistProfilePatch } from '../../../hooks/useLifeOS';
import { exportJsonNativeOrWeb } from '../../../core/native/mobileBridge';
import { ModalPortal } from '../../../components/ModalPortal';
import { SUPPORTED_LANGUAGES } from '../../../core/i18n/i18n';
import { useUIStore, type ThemeMode } from '../../../state/useUIStore';
import { PWAInstallButton } from '../../../components/PWAInstallButton';
import {
  hasWebAuthnCredential,
  isBiometricAvailableAsync,
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

  const fontScale = useUIStore((s) => s.fontScale);
  const setFontScale = useUIStore((s) => s.setFontScale);
  const activeCurrencies = useUIStore((s) => s.activeCurrencies);
  const addActiveCurrency = useUIStore((s) => s.addActiveCurrency);
  const removeActiveCurrency = useUIStore((s) => s.removeActiveCurrency);
  const [currencyToAdd, setCurrencyToAdd] = useState('');
  const [settingsTab, setSettingsTab] = useState<'general' | 'security' | 'ai_about'>('general');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!langMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [langMenuOpen]);

  // Display name state
  const [displayNameInput, setDisplayNameInput] = useState(
    profile.displayName && profile.displayName !== 'Personal Workspace' ? profile.displayName : ''
  );
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  // PIN form state
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Biometrics state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [webAuthnEnrolled, setWebAuthnEnrolled] = useState(false);
  const [webAuthnBusy, setWebAuthnBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setWebAuthnEnrolled(hasWebAuthnCredential());
    void isBiometricAvailableAsync().then((avail) => {
      if (mounted) setWebAuthnSupported(avail);
    });
    return () => {
      mounted = false;
    };
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
      const sample = 'LifeinOne AES-256-GCM self-test passed';
      const encrypted = await encryptText(sample, key);
      const decrypted = await decryptText(encrypted, key);
      if (decrypted === sample) {
        setRoundTripStatus(`Verified: AES-256-GCM ciphertext (${encrypted.ct.slice(0, 18)}...) decrypted cleanly.`);
      }
    } finally {
      setE2eBusy(false);
    }
  };

  const handleExportJson = async () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      account: authUser ? { uid: authUser.uid, email: authUser.email } : { mode: 'local_offline' },
      profile,
      entitlements,
      featureFlags: DEFAULT_FEATURE_FLAGS,
    };
    const filename = `lifeinone-export-${new Date().toISOString().slice(0, 10)}.json`;
    await exportJsonNativeOrWeb(filename, JSON.stringify(bundle, null, 2));
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {t('settings.title')}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Clean Settings Category Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 w-fit">
        {(
          [
            { id: 'general', label: 'General' },
            { id: 'security', label: 'Security & Backup' },
            { id: 'ai_about', label: 'AI & About' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSettingsTab(tab.id)}
            className={`min-h-[34px] rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              settingsTab === tab.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. Theme & Language (RTL) */}
      {settingsTab === 'general' && (
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

        {/* Editable Display Name */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('home.displayNameLabel')}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {t('ui.displayNameDesc')}
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleaned = displayNameInput.trim();
              void persistProfilePatch({ displayName: cleaned || 'Personal Workspace' });
              showToast(t('home.displayNameSaved'));
            }}
            className="flex items-center gap-2 w-full sm:w-auto"
          >
            <input
              type="text"
              maxLength={60}
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder={t('home.displayNamePlaceholder')}
              className="flex-1 sm:w-48 min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="min-h-[42px] rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
            >
              {t('common.save')}
            </button>
          </form>
        </div>

        {/* Custom Font Size Scale (85% to 125% with - / + buttons) */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Type className="h-4 w-4 text-[var(--accent)]" />
              <span>{t('ui.fontScaleTitle')}</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {t('ui.fontScaleDesc')}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start sm:self-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-1">
            <button
              type="button"
              aria-label="Decrease font size"
              disabled={fontScale <= 85}
              onClick={() => setFontScale(Math.max(85, fontScale - 5))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 btn-spring transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[54px] text-center font-numeric text-xs font-semibold text-[var(--text-primary)]">
              {fontScale}%
            </span>
            <button
              type="button"
              aria-label="Increase font size"
              disabled={fontScale >= 125}
              onClick={() => setFontScale(Math.min(125, fontScale + 5))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 btn-spring transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
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
          <div ref={langMenuRef} className="relative min-w-[230px]">
            {(() => {
              const currentLang =
                SUPPORTED_LANGUAGES.find((l) => l.id === profile.locale) ?? SUPPORTED_LANGUAGES[0];
              return (
                <>
                  <button
                    id="language-select"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={langMenuOpen}
                    onClick={() => setLangMenuOpen((v) => !v)}
                    className="w-full min-h-[42px] flex items-center justify-between gap-2.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      {currentLang.flagSrc ? (
                        <img
                          src={currentLang.flagSrc}
                          alt={currentLang.englishName}
                          className="h-4 w-5 rounded-[3px] object-cover shrink-0 border border-[var(--border-hairline)]"
                        />
                      ) : (
                        <span className="text-base leading-none shrink-0" aria-hidden="true">
                          {currentLang.flag}
                        </span>
                      )}
                      <span className="truncate">
                        {currentLang.nativeName} ({currentLang.englishName})
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                  </button>

                  {langMenuOpen && (
                    <div
                      role="listbox"
                      aria-label={t('settings.languageTitle')}
                      className="absolute end-0 z-30 mt-1.5 w-full min-w-[250px] max-h-72 overflow-y-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 shadow-lg"
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => {
                        const active = profile.locale === lang.id;
                        return (
                          <button
                            key={lang.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              handleLocaleSelect(lang.id);
                              setLangMenuOpen(false);
                            }}
                            className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors ${
                              active
                                ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                                : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                            }`}
                          >
                            {lang.flagSrc ? (
                              <img
                                src={lang.flagSrc}
                                alt={lang.englishName}
                                className="h-4 w-5 rounded-[3px] object-cover shrink-0 border border-[var(--border-hairline)]"
                              />
                            ) : (
                              <span className="text-base leading-none shrink-0" aria-hidden="true">
                                {lang.flag}
                              </span>
                            )}
                            <span className="truncate">
                              {lang.nativeName} ({lang.englishName})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                {GLOBAL_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
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
                {GLOBAL_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Currencies in Forms & Cards */}
          <div className="pt-2 border-t border-[var(--border-hairline)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  Active Currencies ({activeCurrencies.length})
                </h3>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Currencies added here appear in Debts and Finance selectors.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Add global currency"
                  value={currencyToAdd}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code) {
                      addActiveCurrency(code);
                      setCurrencyToAdd('');
                      showToast(`Added ${code} to active currencies.`);
                    }
                  }}
                  className="min-h-[38px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)]"
                >
                  <option value="">+ Add currency...</option>
                  {GLOBAL_CURRENCIES.filter((c) => !activeCurrencies.includes(c.code)).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeCurrencies.map((code) => {
                const meta = getCurrencyMeta(code);
                const isPinned =
                  code === profile.primaryCurrency || code === profile.secondaryCurrency;
                return (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
                  >
                    <span className="font-numeric font-semibold text-[var(--accent)]">{code}</span>
                    <span className="text-[var(--text-muted)]">{meta.symbol}</span>
                    {!isPinned && (
                      <button
                        type="button"
                        aria-label={`Remove ${code}`}
                        onClick={() => removeActiveCurrency(code)}
                        className="ms-0.5 text-[var(--text-muted)] hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* 2. AI Privacy Gate & Module Toggles */}
      {settingsTab === 'ai_about' && (
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
      )}

      {/* 3. Device PIN Lock & Opt-In AES-256-GCM E2E Encryption */}
      {settingsTab === 'security' && (
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
                <span>{t('ui.biometricsTitle')}</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {t('ui.biometricsDesc')}
              </p>
            </div>
            {webAuthnSupported ? (
              webAuthnEnrolled ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{t('ui.biometricsEnrolled')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveBiometrics}
                    className="min-h-[38px] rounded-xl border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  >
                    {t('ui.biometricsRemove')}
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
                  <span>{webAuthnBusy ? t('ui.biometricsEnrolling') : t('ui.biometricsEnable')}</span>
                </button>
              )
            ) : (
              <span className="text-xs text-[var(--text-muted)]">{t('ui.biometricsUnsupported')}</span>
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
                placeholder={t('ui.vaultPassphrasePlaceholder')}
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
                LifeinOne never stores this key or your passphrase. Store it safely outside your phone.
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
      )}

      {/* 4. About & Legal */}
      {settingsTab === 'ai_about' && (
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('settings.aboutTitle')}
          </h2>
          <span className="rounded-full bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
            {t('settings.versionLabel')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setLegalModal('privacy')}
            className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            {t('settings.privacyPolicyBtn')}
          </button>
          <button
            type="button"
            onClick={() => setLegalModal('terms')}
            className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
          >
            {t('settings.termsBtn')}
          </button>
        </div>
      </section>
      )}

      {legalModal && (
        <ModalPortal onClose={() => setLegalModal(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs anim-modal-backdrop"
            onClick={() => setLegalModal(null)}
          >
            <div
              className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden anim-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-6 py-4">
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    {legalModal === 'privacy'
                      ? t('settings.privacyPolicyBtn')
                      : t('settings.termsBtn')}
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    LifeinOne · Effective November 2026
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={() => setLegalModal(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)]">
                {legalModal === 'privacy' ? (
                  <>
                    <p>{t('settings.privacyPolicyBody')}</p>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">1. Local-First Storage &amp; Cloud Sync</h4>
                      <p>
                        Your debts, tasks, reminders, habits, notes, and financial entries are stored locally on your device. If you choose to sign in with your account, your records are synchronized securely to your private cloud workspace so you can access them across devices.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">2. End-to-End Encryption &amp; Document Vault</h4>
                      <p>
                        Locked notes and protected Vault documents are encrypted on-device using AES-256-GCM before being stored. Your Vault passphrase and Recovery Key never leave your device and cannot be reset or read by LifeinOne servers.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">3. AI Assistant Privacy Gate</h4>
                      <p>
                        When you use AI features, only the specific prompt and non-sensitive context you submit are processed. Sensitive Vault files, passports, IDs, and E2E-locked notes are strictly blocked from leaving your device.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">4. Biometrics &amp; Device Permissions</h4>
                      <p>
                        Face ID, Touch ID, and Android Biometric authentication are handled exclusively by your device&apos;s operating system. LifeinOne never collects, stores, or transmits biometric templates. Camera and notification permissions are used only when you scan documents or schedule reminders.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">5. Your Control &amp; Data Deletion</h4>
                      <p>
                        You retain full ownership of your data. You can edit or delete any record at any time, disable AI features in Settings, or delete your account and associated cloud data permanently.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{t('settings.termsBody')}</p>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">1. Acceptance of Terms</h4>
                      <p>
                        By using LifeinOne, you agree to these Terms of Use. LifeinOne is provided as a personal productivity, organization, and financial tracking tool for individual, non-commercial use.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">2. Personal Financial &amp; Debt Tracking Disclaimer</h4>
                      <p>
                        LifeinOne helps you record personal debts, budgets, expenses, and currency conversions. It does not provide financial, legal, tax, or accounting advice, nor does it execute real-money transfers. Always verify critical balances and exchange rates independently.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">3. Security &amp; Recovery Responsibility</h4>
                      <p>
                        You are responsible for safeguarding your device PIN and any optional E2E Vault passphrase or Recovery Key. Because encrypted data cannot be decrypted without your passphrase, lost credentials cannot be recovered by LifeinOne.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">4. AI-Generated Suggestions</h4>
                      <p>
                        AI-assisted parsing and daily briefings are provided as convenience drafts. LifeinOne requires your explicit confirmation before saving AI-proposed changes; you are responsible for reviewing accuracy before confirming.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-semibold text-[var(--text-primary)]">5. Availability &amp; Updates</h4>
                      <p>
                        We continually improve LifeinOne and may update features or these terms over time. Continued use of the application after updates constitutes acceptance of the revised terms.
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="shrink-0 flex justify-end border-t border-[var(--border-hairline)] px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => setLegalModal(null)}
                  className="min-h-[40px] rounded-xl bg-[var(--accent)] px-5 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
