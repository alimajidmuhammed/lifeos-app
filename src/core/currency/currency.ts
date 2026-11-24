export type CurrencyCode = 'IQD' | 'USD' | 'EUR';
export type SupportedLocale = 'en' | 'ar' | 'ckb';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  minorDecimals: number;
  factor: number;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  IQD: { code: 'IQD', symbol: 'IQD', minorDecimals: 0, factor: 1 },
  USD: { code: 'USD', symbol: '$', minorDecimals: 2, factor: 100 },
  EUR: { code: 'EUR', symbol: '€', minorDecimals: 2, factor: 100 },
};

/**
 * Converts a major decimal input (e.g. 12.50 USD or 25000 IQD) to safe integer minor units.
 */
export function toMinorUnits(majorAmount: number, currency: CurrencyCode): number {
  if (!Number.isFinite(majorAmount)) {
    throw new Error('Amount must be a finite number');
  }
  const { factor } = CURRENCY_META[currency];
  return Math.round(majorAmount * factor);
}

/**
 * Converts integer minor units back to major decimal value.
 */
export function fromMinorUnits(minorAmount: number, currency: CurrencyCode): number {
  if (!Number.isInteger(minorAmount)) {
    throw new Error('Minor amount must be an integer');
  }
  const { factor } = CURRENCY_META[currency];
  return minorAmount / factor;
}

export interface FxRatesToIqd {
  IQD: 1;
  USD: number;
  EUR: number;
}

export const DEFAULT_FX_RATES_TO_IQD: FxRatesToIqd = {
  IQD: 1,
  USD: 1500,
  EUR: 1620,
};

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
  const rateFromTo =
    typeof rateOrTable === 'number'
      ? rateOrTable
      : rateOrTable[from] / rateOrTable[to];
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
  const { minorDecimals } = CURRENCY_META[currency];
  const intlLocale = locale === 'ar' ? 'ar-IQ-u-nu-latn' : locale === 'ckb' ? 'ckb-IQ-u-nu-latn' : 'en-US';
  const formattedNumber = new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: minorDecimals,
    maximumFractionDigits: minorDecimals,
  }).format(major);

  if (currency === 'IQD') {
    return locale === 'ar' || locale === 'ckb' ? `${formattedNumber} د.ع` : `${formattedNumber} IQD`;
  }
  if (currency === 'USD') {
    return `$${formattedNumber}`;
  }
  return `€${formattedNumber}`;
}
