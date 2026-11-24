import type { VaultDocType } from './vaultSchemas';

export interface ExtractedVaultFields {
  title?: string;
  docType?: VaultDocType;
  expiryDate?: string; // YYYY-MM-DD
  issueDate?: string; // YYYY-MM-DD
  issuer?: string;
  documentNumberLast4?: string;
  extractedText?: string;
}

const DOC_TYPE_KEYWORDS: Array<{ type: VaultDocType; pattern: RegExp }> = [
  { type: 'passport', pattern: /\bpassport\b|جواز\s*سفر|پاسپۆرت/i },
  { type: 'id', pattern: /\bnational\s*id\b|\bid\s*card\b|\bidentity\b|بطاقة\s*وطنية|هوية|ناسنامە/i },
  { type: 'license', pattern: /\bdriver'?s?\s*licen[sc]e\b|\blicense\b|رخصة\s*قيادة|مۆڵەتی\s*شۆفێری/i },
  { type: 'insurance', pattern: /\binsurance\b|\bpolicy\b|تأمين|بیمە/i },
  { type: 'warranty', pattern: /\bwarranty\b|\bguarantee\b|ضمان|گەرەنتی/i },
  { type: 'invoice', pattern: /\binvoice\b|\bbill\b|فاتورة|پسوڵە/i },
  { type: 'contract', pattern: /\bcontract\b|\bagreement\b|\blease\b|عقد|گرێبەست/i },
  { type: 'receipt', pattern: /\breceipt\b|إيصال|وەسڵ/i },
  { type: 'medical', pattern: /\bmedical\b|\blab\b|\bprescription\b|\bhospital\b|طبي|پشکنین|پزیشکی/i },
];

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function normalizeDateCandidate(raw: string): string | null {
  const s = raw.trim();
  // 1. YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y >= 1950 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  // 2. DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const p1 = Number(m[1]);
    const p2 = Number(m[2]);
    const y = Number(m[3]);
    if (y >= 1950 && y <= 2099) {
      // Treat as DD/MM/YYYY unless p2 > 12 (MM/DD/YYYY)
      const d = p2 > 12 ? p2 : p1;
      const mo = p2 > 12 ? p1 : p2;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  // 3. DD MMM YYYY (e.g., 15 Jan 2029)
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_MAP[m[2].toLowerCase()];
    const y = Number(m[3]);
    if (mo && y >= 1950 && y <= 2099 && d >= 1 && d <= 31) {
      return `${y}-${mo}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Extracts readable text from uncompressed PDF `BT ... ET` text blocks locally (no network/cloud).
 * Filters out binary image streams (`DCTDecode`/`FlateDecode`) so image-only PDFs never produce garbage.
 */
export function extractTextFromPdfBytesLocally(bytes: Uint8Array): string {
  const maxScan = Math.min(bytes.byteLength, 512 * 1024);
  const slice = bytes.subarray(0, maxScan);
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(slice);

  // Strip binary stream payloads before scanning for text operators
  const withoutBinaryStreams = raw.replace(/stream[\r\n]+[\s\S]*?endstream/g, (block) => {
    // Keep only if it looks like plain ASCII text operators (BT ... ET)
    if (block.includes('BT') && block.includes('ET') && !/[\x00-\x08\x0E-\x1F\x80-\xFF]{4,}/.test(block)) {
      return block;
    }
    return '';
  });

  const chunks: string[] = [];
  const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btRegex.exec(withoutBinaryStreams)) !== null) {
    const btBody = btMatch[1];
    const parenRegex = /\(([^()\\]{2,160})\)/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = parenRegex.exec(btBody)) !== null) {
      const cleaned = pMatch[1].replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
      // Require at least 65% alphanumeric/space characters to reject binary noise
      const alnumCount = (cleaned.match(/[A-Za-z0-9 ]/g) ?? []).length;
      if (cleaned.length >= 2 && alnumCount / cleaned.length >= 0.65 && /[A-Za-z0-9]{2,}/.test(cleaned)) {
        chunks.push(cleaned);
      }
      if (chunks.length > 300) break;
    }
    if (chunks.length > 300) break;
  }

  return chunks.join('\n').slice(0, 8000);
}

/**
 * Parses standard TD3 Passport Machine Readable Zone (MRZ) lines (e.g. `P<IRQ...`).
 */
function parsePassportMrz(text: string): Partial<ExtractedVaultFields> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => l.length >= 28);

  const line1 = lines.find((l) => /^P<[A-Z]{3}/.test(l));
  if (!line1) return {};

  const out: Partial<ExtractedVaultFields> = { docType: 'passport' };
  const countryCode = line1.slice(2, 5);
  if (countryCode === 'IRQ') {
    out.issuer = 'Republic of Iraq — Directorate of Passports';
  } else if (/^[A-Z]{3}$/.test(countryCode)) {
    out.issuer = `Passport Authority (${countryCode})`;
  }

  // Name after country code: SURNAME<<GIVEN<NAMES
  const nameRaw = line1.slice(5).replace(/<+$/g, '');
  const [surname, given] = nameRaw.split('<<');
  const fullName = [given?.replace(/</g, ' ').trim(), surname?.replace(/</g, ' ').trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (fullName.length >= 2) {
    out.title = `Passport — ${fullName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`;
  }

  // Find Line 2 right after Line 1 (contains passport number + DOB + Expiry YYMMDD)
  const idx1 = lines.indexOf(line1);
  const line2 = lines[idx1 + 1];
  if (line2 && line2.length >= 28) {
    const docNum = line2.slice(0, 10).replace(/</g, '').trim();
    if (docNum.length >= 4) {
      out.documentNumberLast4 = docNum;
    }
    // Standard TD3 positions: 21..27 is YYMMDD expiry date
    const expMatch = line2.slice(20, 29).match(/(\d{2})(\d{2})(\d{2})/);
    if (expMatch) {
      const yy = Number(expMatch[1]);
      const mm = Number(expMatch[2]);
      const dd = Number(expMatch[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
        out.expiryDate = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
  }

  return out;
}

/**
 * Deterministic, 100% local on-device document metadata extractor.
 * Parses filename + optional OCR/PDF text for docType, title, expiryDate, issueDate, issuer, and last4.
 */
export function extractDocumentMetadataLocally(params: {
  fileName?: string;
  text?: string;
  todayYmd?: string;
}): ExtractedVaultFields {
  const fileName = params.fileName ?? '';
  const text = params.text ?? '';
  const combined = `${fileName.replace(/[_-]+/g, ' ')}\n${text}`;
  const todayYmd = params.todayYmd ?? new Date().toISOString().slice(0, 10);

  const out: ExtractedVaultFields = {};
  if (text.trim()) {
    out.extractedText = text.trim().slice(0, 8000);
  }

  // 0. Check Passport MRZ first (highest accuracy for Iraqi & international passports)
  const mrz = parsePassportMrz(text);
  if (mrz.docType) out.docType = mrz.docType;
  if (mrz.title) out.title = mrz.title;
  if (mrz.issuer) out.issuer = mrz.issuer;
  if (mrz.expiryDate) out.expiryDate = mrz.expiryDate;
  if (mrz.documentNumberLast4) out.documentNumberLast4 = mrz.documentNumberLast4;

  // 1. Detect docType
  if (!out.docType) {
    for (const rule of DOC_TYPE_KEYWORDS) {
      if (rule.pattern.test(combined)) {
        out.docType = rule.type;
        break;
      }
    }
  }

  // 2. Clean Title from filename if meaningful and not already set by MRZ
  if (!out.title && fileName) {
    const cleanBase = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanBase.length >= 2) {
      out.title = cleanBase.slice(0, 120);
    }
  }

  // 3. Extract dates with context (Expiry vs Issue)
  const datePattern = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/gi;
  const expiryCtxRegex = /(?:exp|expiry|expires|expiration|valid\s*(?:until|thru|to)|انتهاء|صلاحية|بەسەرچوون)/i;
  const issueCtxRegex = /(?:issue|issued|doi|date\s*of\s*issue|created|إصدار|صدور|دەرچوون)/i;

  const allDates: Array<{ ymd: string; idx: number; ctx: string }> = [];
  let dm: RegExpExecArray | null;
  while ((dm = datePattern.exec(combined)) !== null) {
    const norm = normalizeDateCandidate(dm[0]);
    if (norm) {
      const lineStart = Math.max(0, combined.lastIndexOf('\n', dm.index) + 1);
      const ctxStart = Math.max(lineStart, dm.index - 32);
      const ctx = combined.slice(ctxStart, dm.index);
      allDates.push({ ymd: norm, idx: dm.index, ctx });
    }
  }

  for (const d of allDates) {
    if (!out.expiryDate && expiryCtxRegex.test(d.ctx)) {
      out.expiryDate = d.ymd;
    } else if (!out.issueDate && issueCtxRegex.test(d.ctx)) {
      out.issueDate = d.ymd;
    }
  }

  // Fallback date assignment if context keywords weren't present
  if (!out.expiryDate) {
    const future = allDates.find((d) => d.ymd > todayYmd);
    if (future) out.expiryDate = future.ymd;
  }
  if (!out.issueDate) {
    const past = allDates.find((d) => d.ymd <= todayYmd && d.ymd !== out.expiryDate);
    if (past) out.issueDate = past.ymd;
  }

  // 4. Extract Issuer / Authority
  const issuerMatch = combined.match(
    /(?:issuer|issued[ \t]*by|authority|ministry[ \t]*of[ \t]*[A-Za-z \t]{2,30}|directorate[ \t]*of[ \t]*[A-Za-z \t]{2,30})[: \t-]*([A-Za-z0-9 \t.&'-]{2,60})/i
  );
  if (issuerMatch) {
    const candidate = issuerMatch[1] ? issuerMatch[1].trim() : issuerMatch[0].trim();
    if (candidate.length >= 2) {
      out.issuer = candidate.slice(0, 100);
    }
  }

  // 5. Extract full Document / ID Number (must contain at least one digit)
  const docNumMatch = combined.match(/(?:no\.?|number|id|doc|passport|#)\s*[:#-]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,32})\b/i);
  if (docNumMatch) {
    out.documentNumberLast4 = docNumMatch[1].trim();
  }

  return out;
}
