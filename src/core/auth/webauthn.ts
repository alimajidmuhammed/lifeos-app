/**
 * WebAuthn Biometric Authentication for LifeOS App Lock
 * Uses navigator.credentials.create/get for Touch ID / Face ID / Windows Hello
 * Credential ID is stored in localStorage; private key never leaves the device.
 * WebAuthn requires a Secure Context (HTTPS or localhost).
 */

const WEBAUTHN_CREDENTIAL_KEY = 'lifeos_webauthn_credential_id_v1';
const WEBAUTHN_USER_ID = 'lifeos-local-user';

export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  // window.isSecureContext checks if running under HTTPS or localhost/127.0.0.1
  return Boolean(window.isSecureContext);
}

export function getRpId(): string {
  if (typeof window === 'undefined') return 'localhost';
  const hostname = window.location.hostname;
  return hostname || 'localhost';
}

export function isWebAuthnSupported(): boolean {
  return (
    isSecureContext() &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export function hasWebAuthnCredential(): boolean {
  try {
    return Boolean(localStorage.getItem(WEBAUTHN_CREDENTIAL_KEY));
  } catch {
    return false;
  }
}

function getStoredCredentialId(): ArrayBuffer | null {
  try {
    const b64 = localStorage.getItem(WEBAUTHN_CREDENTIAL_KEY);
    if (!b64) return null;
    const binary = atob(b64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function generateChallenge(): Uint8Array<ArrayBuffer> {
  const challenge = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(challenge);
  return challenge;
}

/**
 * Register a new WebAuthn credential (biometric enrollment).
 * Returns true on success, false if cancelled or unsupported.
 */
export async function registerWebAuthn(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;

  try {
    const userIdBytes = new TextEncoder().encode(WEBAUTHN_USER_ID);
    const rpId = getRpId();

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: generateChallenge(),
        rp: { name: 'LifeOS', id: rpId },
        user: {
          id: userIdBytes,
          name: 'LifeOS User',
          displayName: 'LifeOS Local User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    });

    if (!credential) return false;

    const pubKeyCred = credential as PublicKeyCredential;
    const credId = arrayBufferToBase64(pubKeyCred.rawId);
    localStorage.setItem(WEBAUTHN_CREDENTIAL_KEY, credId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate using existing WebAuthn credential (biometric verification).
 * Returns true if biometric check passes, false otherwise.
 */
export async function authenticateWebAuthn(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;

  const credId = getStoredCredentialId();
  if (!credId) return false;

  try {
    const rpId = getRpId();
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: generateChallenge(),
        rpId,
        allowCredentials: [
          {
            type: 'public-key',
            id: credId,
            transports: ['internal'],
          },
        ],
        userVerification: 'preferred',
        timeout: 60_000,
      },
    });

    return Boolean(assertion);
  } catch {
    return false;
  }
}

/**
 * Remove stored WebAuthn credential.
 */
export function removeWebAuthnCredential(): void {
  try {
    localStorage.removeItem(WEBAUTHN_CREDENTIAL_KEY);
  } catch {
    // Ignore
  }
}
