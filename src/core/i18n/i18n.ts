import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { SupportedLocale } from '../currency/currency';
import { en } from './locales/en';
import { ar } from './locales/ar';
import { ckb } from './locales/ckb';
import { kmr } from './locales/kmr';
import { fa } from './locales/fa';
import { tr } from './locales/tr';
import { ru } from './locales/ru';
import { id } from './locales/id';
import { es } from './locales/es';
import { de } from './locales/de';

export interface LanguageOption {
  id: SupportedLocale;
  nativeName: string;
  englishName: string;
  flag: string;
  rtl: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', flag: '🇺🇸', rtl: false },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic', flag: '🇸🇦', rtl: true },
  { id: 'ckb', nativeName: 'کوردی سۆرانی', englishName: 'Kurdish Sorani', flag: '🇮🇶', rtl: true },
  { id: 'kmr', nativeName: 'کوردی بادینی', englishName: 'Kurdish Behdini', flag: '🇮🇶', rtl: true },
  { id: 'fa', nativeName: 'فارسی', englishName: 'Persian', flag: '🇮🇷', rtl: true },
  { id: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', flag: '🇹🇷', rtl: false },
  { id: 'ru', nativeName: 'Русский', englishName: 'Russian', flag: '🇷🇺', rtl: false },
  { id: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', flag: '🇮🇩', rtl: false },
  { id: 'es', nativeName: 'Español', englishName: 'Spanish', flag: '🇪🇸', rtl: false },
  { id: 'de', nativeName: 'Deutsch', englishName: 'German', flag: '🇩🇪', rtl: false },
];

export const RTL_LOCALES: SupportedLocale[] = ['ar', 'ckb', 'kmr', 'fa'];

const ALL_LOCALE_IDS = new Set<SupportedLocale>(SUPPORTED_LANGUAGES.map((l) => l.id));

export function isRtlLocale(locale: SupportedLocale): boolean {
  return RTL_LOCALES.includes(locale);
}

const resources: Resource = {
  en: { translation: en },
  ar: { translation: ar },
  ckb: { translation: ckb },
  kmr: { translation: kmr },
  fa: { translation: fa },
  tr: { translation: tr },
  ru: { translation: ru },
  id: { translation: id },
  es: { translation: es },
  de: { translation: de },
};

export function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
  }
  try {
    localStorage.setItem('lifeos_locale', locale);
  } catch {
    // Ignore storage quota errors
  }
}

const initialLocale: SupportedLocale = (() => {
  try {
    const saved = localStorage.getItem('lifeos_locale') as SupportedLocale | null;
    if (saved && ALL_LOCALE_IDS.has(saved)) return saved;
  } catch {
    // Ignore
  }
  return 'en';
})();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

applyDocumentLocale(initialLocale);

export default i18n;
