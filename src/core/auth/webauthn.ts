import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Unified Biometric Authentication for LifeinOne App Lock
 * - Native iOS/Android (Capacitor): uses Face ID / Touch ID / BiometricPrompt via NativeBiometricPlugin
 * - Web / PWA: uses WebAuthn (navigator.credentials.create/get)
 */

interface NativeBiometricPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  authenticate(options?: { title?: string; reason?: string }): Promise<{ verified: boolean; error?: string }>;
}

const NativeBiometric = registerPlugin<NativeBiometricPlugin>('NativeBiometric');

const WEBAUTHN_CREDENTIAL_KEY = 'lifeos_webauthn_credential_id_v1';
const WEBAUTHN_USER_ID = 'lifeos-local-user';

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

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
  if (isNativePlatform()) return true;
  return (
    isSecureContext() &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function isBiometricAvailableAsync(): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      const res = await NativeBiometric.isAvailable();
      return Boolean(res?.available);
    } catch {
      return false;
    }
  }
  return isWebAuthnSupported();
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
  if (isNativePlatform()) {
    try {
      const avail = await NativeBiometric.isAvailable();
      if (!avail?.available) return false;
      const res = await NativeBiometric.authenticate({
        title: 'Enable Biometric Lock',
        reason: 'Verify your identity to enable biometric unlock for LifeinOne',
      });
      if (res?.verified) {
        localStorage.setItem(WEBAUTHN_CREDENTIAL_KEY, 'native_biometric_enrolled');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  if (!isWebAuthnSupported()) return false;

  try {
    const userIdBytes = new TextEncoder().encode(WEBAUTHN_USER_ID);
    const rpId = getRpId();

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: generateChallenge(),
        rp: { name: 'LifeinOne', id: rpId },
        user: {
          id: userIdBytes,
          name: 'LifeinOne User',
          displayName: 'LifeinOne Local User',
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
  if (isNativePlatform()) {
    if (!hasWebAuthnCredential()) return false;
    try {
      const res = await NativeBiometric.authenticate({
        title: 'Unlock LifeinOne',
        reason: 'Verify your identity to unlock LifeinOne',
      });
      return Boolean(res?.verified);
    } catch {
      return false;
    }
  }

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
