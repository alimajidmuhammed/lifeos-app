export type CurrencyCode = string;
export type SupportedLocale =
  | 'en'
  | 'ar'
  | 'ckb'
  | 'kmr'
  | 'fa'
  | 'tr'
  | 'ru'
  | 'id'
  | 'es'
  | 'de';

const INTL_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
  ar: 'ar-IQ-u-nu-latn',
  ckb: 'ckb-IQ-u-nu-latn',
  kmr: 'ckb-IQ-u-nu-latn',
  fa: 'fa-IR-u-nu-latn',
  tr: 'tr-TR',
  ru: 'ru-RU',
  id: 'id-ID',
  es: 'es-ES',
  de: 'de-DE',
};

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
  minorDecimals: number;
  factor: number;
  defaultRateToIqd: number;
}

export const GLOBAL_CURRENCIES: CurrencyMeta[] = [
  { code: 'IQD', symbol: 'IQD', name: 'Iraqi Dinar', minorDecimals: 0, factor: 1, defaultRateToIqd: 1 },
  { code: 'USD', symbol: '$', name: 'US Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 1500 },
  { code: 'EUR', symbol: '€', name: 'Euro', minorDecimals: 2, factor: 100, defaultRateToIqd: 1620 },
  { code: 'GBP', symbol: '£', name: 'British Pound', minorDecimals: 2, factor: 100, defaultRateToIqd: 1900 },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', minorDecimals: 2, factor: 100, defaultRateToIqd: 43 },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham', minorDecimals: 2, factor: 100, defaultRateToIqd: 408 },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyal', minorDecimals: 2, factor: 100, defaultRateToIqd: 400 },
  { code: 'KWD', symbol: 'KWD', name: 'Kuwaiti Dinar', minorDecimals: 3, factor: 1000, defaultRateToIqd: 4880 },
  { code: 'QAR', symbol: 'QAR', name: 'Qatari Riyal', minorDecimals: 2, factor: 100, defaultRateToIqd: 412 },
  { code: 'BHD', symbol: 'BHD', name: 'Bahraini Dinar', minorDecimals: 3, factor: 1000, defaultRateToIqd: 3980 },
  { code: 'OMR', symbol: 'OMR', name: 'Omani Rial', minorDecimals: 3, factor: 1000, defaultRateToIqd: 3900 },
  { code: 'JOD', symbol: 'JOD', name: 'Jordanian Dinar', minorDecimals: 3, factor: 1000, defaultRateToIqd: 2115 },
  { code: 'EGP', symbol: 'EGP', name: 'Egyptian Pound', minorDecimals: 2, factor: 100, defaultRateToIqd: 30 },
  { code: 'LBP', symbol: 'LBP', name: 'Lebanese Pound', minorDecimals: 0, factor: 1, defaultRateToIqd: 0.017 },
  { code: 'IRR', symbol: 'IRR', name: 'Iranian Rial', minorDecimals: 0, factor: 1, defaultRateToIqd: 0.035 },
  { code: 'SYP', symbol: 'SYP', name: 'Syrian Pound', minorDecimals: 0, factor: 1, defaultRateToIqd: 0.11 },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', minorDecimals: 2, factor: 100, defaultRateToIqd: 1700 },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 1070 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 970 },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 890 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', minorDecimals: 0, factor: 1, defaultRateToIqd: 9.8 },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', minorDecimals: 2, factor: 100, defaultRateToIqd: 207 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', minorDecimals: 2, factor: 100, defaultRateToIqd: 17.8 },
  { code: 'PKR', symbol: 'Rs', name: 'Pakistani Rupee', minorDecimals: 2, factor: 100, defaultRateToIqd: 5.4 },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', minorDecimals: 0, factor: 1, defaultRateToIqd: 1.07 },
  { code: 'RUB', symbol: '₽', name: 'Russian Ruble', minorDecimals: 2, factor: 100, defaultRateToIqd: 15 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', minorDecimals: 2, factor: 100, defaultRateToIqd: 258 },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', minorDecimals: 2, factor: 100, defaultRateToIqd: 74 },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', minorDecimals: 2, factor: 100, defaultRateToIqd: 140 },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', minorDecimals: 2, factor: 100, defaultRateToIqd: 136 },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', minorDecimals: 2, factor: 100, defaultRateToIqd: 217 },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', minorDecimals: 2, factor: 100, defaultRateToIqd: 375 },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', minorDecimals: 2, factor: 100, defaultRateToIqd: 83 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 1115 },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', minorDecimals: 2, factor: 100, defaultRateToIqd: 193 },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', minorDecimals: 2, factor: 100, defaultRateToIqd: 43 },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', minorDecimals: 2, factor: 100, defaultRateToIqd: 336 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', minorDecimals: 0, factor: 1, defaultRateToIqd: 0.094 },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', minorDecimals: 2, factor: 100, defaultRateToIqd: 25.5 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', minorDecimals: 0, factor: 1, defaultRateToIqd: 0.059 },
  { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham', minorDecimals: 2, factor: 100, defaultRateToIqd: 150 },
  { code: 'TND', symbol: 'TND', name: 'Tunisian Dinar', minorDecimals: 3, factor: 1000, defaultRateToIqd: 478 },
  { code: 'DZD', symbol: 'DZD', name: 'Algerian Dinar', minorDecimals: 2, factor: 100, defaultRateToIqd: 11.2 },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', minorDecimals: 2, factor: 100, defaultRateToIqd: 0.9 },
  { code: 'KES', symbol: 'KES', name: 'Kenyan Shilling', minorDecimals: 2, factor: 100, defaultRateToIqd: 11.6 },
  { code: 'ARS', symbol: 'ARS', name: 'Argentine Peso', minorDecimals: 2, factor: 100, defaultRateToIqd: 1.5 },
  { code: 'COP', symbol: 'COP', name: 'Colombian Peso', minorDecimals: 2, factor: 100, defaultRateToIqd: 0.34 },
  { code: 'CLP', symbol: 'CLP', name: 'Chilean Peso', minorDecimals: 0, factor: 1, defaultRateToIqd: 1.54 },
];

export const CURRENCY_META: Record<string, CurrencyMeta> = Object.fromEntries(
  GLOBAL_CURRENCIES.map((c) => [c.code, c])
);

export function getCurrencyMeta(code: CurrencyCode): CurrencyMeta {
  return (
    CURRENCY_META[code] ?? {
      code,
      symbol: code,
      name: code,
      minorDecimals: 2,
      factor: 100,
      defaultRateToIqd: 1500,
    }
  );
}

/**
 * Converts a major decimal input (e.g. 12.50 USD or 25000 IQD) to safe integer minor units.
 */
export function toMinorUnits(majorAmount: number, currency: CurrencyCode): number {
  if (!Number.isFinite(majorAmount)) {
    throw new Error('Amount must be a finite number');
  }
  const { factor } = getCurrencyMeta(currency);
  return Math.round(majorAmount * factor);
}

/**
 * Converts integer minor units back to major decimal value.
 */
export function fromMinorUnits(minorAmount: number, currency: CurrencyCode): number {
  if (!Number.isInteger(minorAmount)) {
    throw new Error('Minor amount must be an integer');
  }
  const { factor } = getCurrencyMeta(currency);
  return minorAmount / factor;
}

export type FxRatesToIqd = Record<string, number>;

export const DEFAULT_FX_RATES_TO_IQD: FxRatesToIqd = Object.fromEntries(
  GLOBAL_CURRENCIES.map((c) => [c.code, c.defaultRateToIqd])
);

/**
 * Converts an amount in minor units from one currency to another using either an explicit
 * numeric snapshot rate (units of target major per 1 unit of source major) or an FxRatesToIqd table.
 */
export function convertMinorUnits(
  sourceMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateOrTable: number | FxRatesToIqd
): number {
  if (!Number.isInteger(sourceMinor)) {
    throw new Error('Source minor amount must be an integer');
  }
  if (from === to) return sourceMinor;
  const fromRate = typeof rateOrTable === 'number' ? 1 : (rateOrTable[from] ?? getCurrencyMeta(from).defaultRateToIqd);
  const toRate = typeof rateOrTable === 'number' ? 1 : (rateOrTable[to] ?? getCurrencyMeta(to).defaultRateToIqd);
  const rateFromTo = typeof rateOrTable === 'number' ? rateOrTable : fromRate / toRate;
  if (!Number.isFinite(rateFromTo) || rateFromTo <= 0) {
    throw new Error('Exchange rate must be a positive finite number');
  }
  const sourceMajor = fromMinorUnits(sourceMinor, from);
  return toMinorUnits(sourceMajor * rateFromTo, to);
}

/**
 * Formats integer minor units cleanly with locale-aware grouping and Western digits for financial clarity.
 */
export function formatMoney(
  minorAmount: number,
  currency: CurrencyCode,
  locale: SupportedLocale = 'en'
): string {
  const major = fromMinorUnits(minorAmount, currency);
  const { minorDecimals, symbol } = getCurrencyMeta(currency);
  const intlLocale = INTL_LOCALE_MAP[locale] ?? 'en-US';
  const formattedNumber = new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: minorDecimals,
    maximumFractionDigits: minorDecimals,
  }).format(major);

  if (currency === 'IQD') {
    return locale === 'ar' || locale === 'ckb' || locale === 'kmr' || locale === 'fa'
      ? `${formattedNumber} د.ع`
      : `${formattedNumber} IQD`;
  }
  if (currency === 'USD') return `$${formattedNumber}`;
  if (currency === 'EUR') return `€${formattedNumber}`;
  if (currency === 'GBP') return `£${formattedNumber}`;
  if (symbol !== currency && symbol.length <= 3) {
    return `${symbol}${formattedNumber}`;
  }
  return `${formattedNumber} ${currency}`;
}
