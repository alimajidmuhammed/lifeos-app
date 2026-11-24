/**
 * Opt-in Client-Side End-to-End Encryption (AES-256-GCM + PBKDF2-SHA256)
 * Uses standard Web Crypto API (works in browser, Node 22+, and React Native WebCrypto polyfill).
 * Zero-knowledge: passphrase and raw key NEVER leave the device or touch Firestore.
 */

// OWASP 2024 recommended minimum for PBKDF2-HMAC-SHA256
const PBKDF2_ITERATIONS = 310_000;
const VERIFIER_PLAINTEXT = 'LIFEOS_E2E_VERIFIER_V1';

export interface EncryptedEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string; // base64 12-byte IV
  ct: string; // base64 ciphertext + auth tag
}

export interface E2EVaultBootstrap {
  salt: string; // base64 16-byte salt (safe to store in users/{uid})
  verifier: string; // JSON stringified EncryptedEnvelope of VERIFIER_PLAINTEXT
  recoveryKey: string; // Human-readable 32-char grouped recovery key (USER MUST SAVE OFFLINE)
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API is unavailable in this environment.');
  }
  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    const out = new Uint8Array(new ArrayBuffer(buf.length));
    out.set(buf);
    return out;
  }
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function generateRandomSalt(): string {
  const salt = new Uint8Array(new ArrayBuffer(16));
  globalThis.crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

export function generateRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes ambiguous 0/O/1/I
  const bytes = new Uint8Array(new ArrayBuffer(24));
  globalThis.crypto.getRandomValues(bytes);
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return raw.match(/.{1,4}/g)!.join('-'); // e.g., ABCD-EFGH-JKLM-NPQR-STUV-WXYZ
}

export async function deriveAesKeyFromSecret(secret: string, saltBase64: string): Promise<CryptoKey> {
  if (secret.trim().length < 8) {
    throw new Error('Vault passphrase must be at least 8 characters.');
  }
  const subtle = getSubtle();
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const salt = base64ToBytes(saltBase64);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(plaintext: string, key: CryptoKey): Promise<EncryptedEnvelope> {
  const subtle = getSubtle();
  const iv = new Uint8Array(new ArrayBuffer(12));
  globalThis.crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    v: 1,
    alg: 'AES-256-GCM',
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptText(envelope: EncryptedEnvelope, key: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const plainBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plainBuffer);
}

export interface EncryptedBinaryEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  mimeType: string;
  iv: string; // base64 12-byte IV
  ct: Uint8Array; // raw ciphertext + GCM auth tag
}

export async function encryptBytes(
  plainBytes: Uint8Array,
  mimeType: string,
  key: CryptoKey
): Promise<EncryptedBinaryEnvelope> {
  const subtle = getSubtle();
  const iv = new Uint8Array(new ArrayBuffer(12));
  globalThis.crypto.getRandomValues(iv);
  const copy = new Uint8Array(new ArrayBuffer(plainBytes.byteLength));
  copy.set(plainBytes);
  const cipherBuffer = await subtle.encrypt({ name: 'AES-GCM', iv }, key, copy);
  return {
    v: 1,
    alg: 'AES-256-GCM',
    mimeType,
    iv: bytesToBase64(iv),
    ct: new Uint8Array(cipherBuffer),
  };
}

export async function decryptBytes(
  envelope: EncryptedBinaryEnvelope,
  key: CryptoKey
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const iv = base64ToBytes(envelope.iv);
  const copy = new Uint8Array(new ArrayBuffer(envelope.ct.byteLength));
  copy.set(envelope.ct);
  const plainBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, key, copy);
  return new Uint8Array(plainBuffer);
}

/**
 * Bootstraps opt-in E2E encryption by generating a random salt, a user-held Recovery Key,
 * and an encrypted verifier token that proves passphrase validity without storing the passphrase.
 */
export async function bootstrapE2EVault(passphrase: string): Promise<E2EVaultBootstrap> {
  const salt = generateRandomSalt();
  const recoveryKey = generateRecoveryKey();
  const key = await deriveAesKeyFromSecret(passphrase, salt);
  const verifierEnvelope = await encryptText(VERIFIER_PLAINTEXT, key);
  return {
    salt,
    verifier: JSON.stringify(verifierEnvelope),
    recoveryKey,
  };
}

export async function verifyE2EPassphrase(
  passphrase: string,
  salt: string,
  verifierJson: string
): Promise<boolean> {
  try {
    const key = await deriveAesKeyFromSecret(passphrase, salt);
    const envelope = JSON.parse(verifierJson) as EncryptedEnvelope;
    const decrypted = await decryptText(envelope, key);
    return decrypted === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}
