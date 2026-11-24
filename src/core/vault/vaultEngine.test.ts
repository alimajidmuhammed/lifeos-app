import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapE2EVault,
  decryptBytes,
  deriveAesKeyFromSecret,
  encryptBytes,
} from '../crypto/e2eCrypto';
import { evaluatePrivacyGate } from '../ai/privacyGate';
import {
  buildExpiryReminderInput,
  computeVaultSummary,
  evaluateDocumentExpiry,
} from './expiryEngine';
import { buildMultiPagePdfFromJpegs } from './pdfGenerator';
import {
  extractDocumentMetadataLocally,
  extractTextFromPdfBytesLocally,
} from './localDocExtractor';
import {
  buildVaultFolderTree,
  flattenVaultFolderTree,
  formatBytes,
  type VaultDocumentMeta,
  type VaultFolder,
} from './vaultSchemas';

function makeDoc(overrides: Partial<VaultDocumentMeta>): VaultDocumentMeta {
  return {
    id: 'doc_1',
    uid: 'user_1',
    title: 'Iraqi Passport',
    docType: 'passport',
    storageMode: 'local_only',
    mimeType: 'application/pdf',
    sizeBytes: 245760,
    pageCount: 2,
    tags: ['travel'],
    isEncrypted: false,
    isLocked: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('Vault expiry engine accurately classifies expired, critical, soon, valid, and generates reminder drafts', () => {
  const today = '2026-06-01';
  assert.equal(evaluateDocumentExpiry('2026-05-25', today).status, 'expired');
  assert.equal(evaluateDocumentExpiry('2026-05-25', today).daysRemaining, -7);

  assert.equal(evaluateDocumentExpiry('2026-06-20', today).status, 'critical');
  assert.equal(evaluateDocumentExpiry('2026-06-20', today).daysRemaining, 19);

  assert.equal(evaluateDocumentExpiry('2026-08-15', today).status, 'soon');
  assert.equal(evaluateDocumentExpiry('2027-06-01', today).status, 'valid');
  assert.equal(evaluateDocumentExpiry(undefined, today).status, 'no_expiry');

  const docs = [
    makeDoc({ id: 'd1', expiryDate: '2026-05-01', isEncrypted: true, isLocked: true, sizeBytes: 1000 }),
    makeDoc({ id: 'd2', expiryDate: '2026-06-15', sizeBytes: 2000 }),
    makeDoc({ id: 'd3', expiryDate: '2026-08-01', sizeBytes: 3000 }),
    makeDoc({ id: 'd4', expiryDate: '2028-01-01', sizeBytes: 4000 }),
  ];
  const summary = computeVaultSummary(docs, today);
  assert.equal(summary.totalDocs, 4);
  assert.equal(summary.expiredCount, 1);
  assert.equal(summary.expiring30Count, 1);
  assert.equal(summary.expiring90Count, 2);
  assert.equal(summary.encryptedCount, 1);
  assert.equal(summary.totalBytes, 10000);

  const rem = buildExpiryReminderInput(
    makeDoc({ title: 'Passport', expiryDate: '2026-09-01', issuer: 'Baghdad Directorate', documentNumberLast4: '4821' }),
    today,
    30
  );
  assert.ok(rem);
  assert.equal(rem.category, 'expiry');
  assert.equal(rem.dueAtIso, '2026-08-02T09:00:00.000Z');
  assert.match(rem.title, /Renew Passport/);
});

test('Multi-page PDF generator outputs a valid PDF 1.4 binary with exact page count and DCTDecode streams', () => {
  const fakeJpeg1 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const fakeJpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

  const pdfBytes = buildMultiPagePdfFromJpegs([
    { jpegBytes: fakeJpeg1, width: 1200, height: 1600 },
    { jpegBytes: fakeJpeg2, width: 1200, height: 1600 },
  ]);

  const text = new TextDecoder('latin1').decode(pdfBytes);
  assert.ok(text.startsWith('%PDF-1.4\n'), 'Must start with PDF 1.4 header');
  assert.ok(text.includes('/Count 2'), 'Must declare 2 pages');
  assert.ok(text.includes('/Filter /DCTDecode'), 'Must embed JPEG XObjects');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'Must terminate with %%EOF trailer');
});

test('AES-256-GCM binary file encryption round-trips bytes identically and Privacy Gate blocks Vault on free tier', async () => {
  const boot = await bootstrapE2EVault('VaultMasterPass2026!');
  const key = await deriveAesKeyFromSecret('VaultMasterPass2026!', boot.salt);

  const samplePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xde, 0xad, 0xbe, 0xef]);
  const envelope = await encryptBytes(samplePdfBytes, 'application/pdf', key);
  assert.equal(envelope.alg, 'AES-256-GCM');
  assert.equal(envelope.mimeType, 'application/pdf');
  assert.notDeepEqual(Array.from(envelope.ct), Array.from(samplePdfBytes));

  const decrypted = await decryptBytes(envelope, key);
  assert.deepEqual(Array.from(decrypted), Array.from(samplePdfBytes));

  const gate = evaluatePrivacyGate({
    freeTier: true,
    module: 'vault',
    text: 'Extract expiry date from Iraqi passport',
    hasAttachmentImage: true,
    containsVaultSensitiveDoc: true,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, 'BLOCKED_FREE_TIER_VAULT_IMAGE');
});

test('Nested Vault Folder Tree builds cleanly, neutralizes cycles, and formats byte sizes', () => {
  const folders: VaultFolder[] = [
    {
      id: 'f_root',
      uid: 'u1',
      name: 'Identity',
      sortKey: 'V',
      isLockedFolder: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'f_child',
      uid: 'u1',
      name: 'Passports',
      parentId: 'f_root',
      sortKey: 'V',
      isLockedFolder: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'f_cycle',
      uid: 'u1',
      name: 'SelfCycle',
      parentId: 'f_cycle',
      sortKey: 'W',
      isLockedFolder: false,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const flat = flattenVaultFolderTree(buildVaultFolderTree(folders));
  assert.equal(flat.length, 3);
  assert.equal(flat[0].folder.id, 'f_root');
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[1].folder.id, 'f_child');
  assert.equal(flat[1].depth, 1);
  assert.equal(flat[2].folder.id, 'f_cycle');
  assert.equal(flat[2].depth, 0);

  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB');
});

test('Local document extractor parses docType, title, issueDate, expiryDate, issuer, and last4 offline', () => {
  const res = extractDocumentMetadataLocally({
    fileName: 'Iraqi_Passport_Ahmed.pdf',
    text: 'Issued by: Directorate of Passports\nIssue Date: 2023-05-10\nExpiry Date: 2031-05-09\nPassport No: A99884821',
    todayYmd: '2026-11-24',
  });
  assert.equal(res.docType, 'passport');
  assert.equal(res.title, 'Iraqi Passport Ahmed');
  assert.equal(res.issueDate, '2023-05-10');
  assert.equal(res.expiryDate, '2031-05-09');
  assert.equal(res.issuer, 'Directorate of Passports');
  assert.equal(res.documentNumberLast4, 'A99884821');
});

test('Local extractor strips binary PDF image streams and parses Iraqi Passport MRZ cleanly', () => {
  // Simulate an image-only PDF generated by buildMultiPagePdfFromJpegs (should return empty text, NOT binary garbage)
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x28, 0x68, 0x3d, 0x25, 0x29, 0xff, 0xd9]);
  const pdfBytes = buildMultiPagePdfFromJpegs([{ jpegBytes: fakeJpeg, width: 800, height: 600 }]);
  const pdfText = extractTextFromPdfBytesLocally(pdfBytes);
  assert.equal(pdfText, '');

  // Test Iraqi Passport MRZ parsing
  const mrzText = [
    'REPUBLIC OF IRAQ PASSPORT',
    'P<IRQALMALIKI<<OMAR<HASSAN<<<<<<<<<<<<<<<<<<',
    'A123456789IRQ9001154M3105092<<<<<<<<<<<<<<04',
  ].join('\n');
  const parsed = extractDocumentMetadataLocally({ text: mrzText, todayYmd: '2026-11-24' });
  assert.equal(parsed.docType, 'passport');
  assert.equal(parsed.title, 'Passport — Omar Hassan Almaliki');
  assert.equal(parsed.issuer, 'Republic of Iraq — Directorate of Passports');
  assert.equal(parsed.expiryDate, '2031-05-09');
  assert.equal(parsed.documentNumberLast4, 'A123456789');
});
