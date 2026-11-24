import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapE2EVault,
  deriveAesKeyFromSecret,
  encryptText,
  decryptText,
  verifyE2EPassphrase,
} from './e2eCrypto';

test('E2E AES-256-GCM encrypts and decrypts text accurately', async () => {
  const setup = await bootstrapE2EVault('MyStrongVaultPass!2026');
  assert.match(setup.recoveryKey, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);

  const valid = await verifyE2EPassphrase('MyStrongVaultPass!2026', setup.salt, setup.verifier);
  assert.equal(valid, true);

  const invalid = await verifyE2EPassphrase('WrongPassphrase99', setup.salt, setup.verifier);
  assert.equal(invalid, false);

  const key = await deriveAesKeyFromSecret('MyStrongVaultPass!2026', setup.salt);
  const secretNote = 'Passport expires 2031-05-10 · IQD safe combination';
  const encrypted = await encryptText(secretNote, key);

  assert.equal(encrypted.alg, 'AES-256-GCM');
  assert.ok(!encrypted.ct.includes('Passport'));

  const decrypted = await decryptText(encrypted, key);
  assert.equal(decrypted, secretNote);
});

test('E2E rejects short passphrases', async () => {
  await assert.rejects(() => bootstrapE2EVault('short'), /at least 8 characters/);
});
