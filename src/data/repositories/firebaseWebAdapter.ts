import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged as fbOnAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase/firebaseClient';
import {
  createDefaultUserProfile,
  UserProfileSchema,
  type UserProfileData,
} from '../../core/schemas/userProfileSchema';
import {
  DEFAULT_FEATURE_FLAGS,
  PLAN_CATALOG,
  type PlanEntitlements,
  type PlanTier,
} from '../../core/entitlements/entitlements';
import type {
  AiUsageRecord,
  AiUsageRepository,
  AuthRepository,
  AuthUserSummary,
  LocalVaultEntryMeta,
  LocalVaultStorageAdapter,
  UserProfileRepository,
} from './interfaces';

function mapFirebaseUser(user: User): AuthUserSummary {
  return {
    uid: user.uid,
    displayName: user.displayName || user.email?.split('@')[0] || 'LifeOS User',
    email: user.email,
    emailVerified: user.emailVerified,
    photoURL: user.photoURL,
  };
}

export class FirebaseWebAuthRepository implements AuthRepository {
  onAuthStateChanged(callback: (user: AuthUserSummary | null) => void): () => void {
    void getRedirectResult(auth).catch(() => {
      // Ignore empty/cancelled redirect
    });
    return fbOnAuthStateChanged(auth, (fbUser) => {
      callback(fbUser ? mapFirebaseUser(fbUser) : null);
    });
  }

  async signInWithGoogle(): Promise<AuthUserSummary> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const credential = await signInWithPopup(auth, provider);
      return mapFirebaseUser(credential.user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, provider);
        throw new Error('Redirecting to Google Sign-In...');
      }
      throw err;
    }
  }

  async signInWithApple(): Promise<AuthUserSummary> {
    if (!DEFAULT_FEATURE_FLAGS['auth.apple.enabled']) {
      throw new Error(
        'Sign in with Apple is disabled behind feature flag auth.apple.enabled=false during Stage 0. Enable after configuring Apple Developer Services ID and Firebase Auth.'
      );
    }
    throw new Error('Apple Sign-In provider is not yet configured.');
  }

  async signOut(): Promise<void> {
    await fbSignOut(auth);
  }
}

export class FirebaseWebUserProfileRepository implements UserProfileRepository {
  subscribeProfile(
    uid: string,
    onData: (profile: UserProfileData) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}`;
    const ref = doc(db, 'users', uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const raw = snap.data();
        const parsed = UserProfileSchema.safeParse(raw);
        if (parsed.success) {
          onData(parsed.data);
        }
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.GET, path);
      }
    );
  }

  async ensureProfile(user: AuthUserSummary): Promise<UserProfileData> {
    const path = `users/${user.uid}`;
    const ref = doc(db, 'users', user.uid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const parsed = UserProfileSchema.safeParse(snap.data());
        if (parsed.success) return parsed.data;
      }

      const defaults = createDefaultUserProfile(
        user.uid,
        user.displayName,
        user.email ?? undefined
      );
      // Validate strictly against blueprint schema prior to write
      const validated = UserProfileSchema.parse(defaults);
      await setDoc(ref, {
        ...validated,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return validated;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async updateProfile(
    uid: string,
    current: UserProfileData,
    patch: Partial<UserProfileData>
  ): Promise<void> {
    const path = `users/${uid}`;
    const ref = doc(db, 'users', uid);
    const next: UserProfileData = {
      ...current,
      ...patch,
      uid,
      version: current.version + 1,
    };
    const validated = UserProfileSchema.parse(next);

    // Explicitly send only allowed mutable fields to satisfy Eight-Pillar affectedKeys().hasOnly()
    const payload: Record<string, unknown> = {
      displayName: validated.displayName,
      locale: validated.locale,
      theme: validated.theme,
      primaryCurrency: validated.primaryCurrency,
      secondaryCurrency: validated.secondaryCurrency,
      vaultStorageMode: validated.vaultStorageMode,
      aiGlobalEnabled: validated.aiGlobalEnabled,
      analyticsConsent: validated.analyticsConsent,
      aiPrivacyNoticeAccepted: validated.aiPrivacyNoticeAccepted,
      e2eConfigured: validated.e2eConfigured,
      version: validated.version,
      updatedAt: serverTimestamp(),
    };

    if (validated.email !== undefined) payload.email = validated.email;
    if (validated.aiModuleToggles !== undefined) payload.aiModuleToggles = validated.aiModuleToggles;
    if (validated.e2eSalt !== undefined) payload.e2eSalt = validated.e2eSalt;
    if (validated.e2eVerifier !== undefined) payload.e2eVerifier = validated.e2eVerifier;
    if (validated.quietHoursStart !== undefined) payload.quietHoursStart = validated.quietHoursStart;
    if (validated.quietHoursEnd !== undefined) payload.quietHoursEnd = validated.quietHoursEnd;

    try {
      await updateDoc(ref, payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  subscribeEntitlements(
    uid: string,
    onData: (entitlements: PlanEntitlements) => void
  ): () => void {
    const path = `users/${uid}/entitlements/current`;
    const ref = doc(db, 'users', uid, 'entitlements', 'current');
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          onData(PLAN_CATALOG.free);
          return;
        }
        const raw = snap.data();
        const tier = (raw.plan as PlanTier) in PLAN_CATALOG ? (raw.plan as PlanTier) : 'free';
        onData({
          ...PLAN_CATALOG[tier],
          aiDailyQuota:
            typeof raw.aiDailyQuota === 'number'
              ? raw.aiDailyQuota
              : PLAN_CATALOG[tier].aiDailyQuota,
          storageMbLimit:
            typeof raw.storageMbLimit === 'number'
              ? raw.storageMbLimit
              : PLAN_CATALOG[tier].storageMbLimit,
          maxDocuments:
            typeof raw.maxDocuments === 'number'
              ? raw.maxDocuments
              : PLAN_CATALOG[tier].maxDocuments,
          e2eVaultAllowed:
            typeof raw.e2eVaultAllowed === 'boolean'
              ? raw.e2eVaultAllowed
              : PLAN_CATALOG[tier].e2eVaultAllowed,
        });
      },
      (err) => {
        // Default safely to Free tier if entitlements doc does not exist yet
        console.warn('Entitlements snapshot fell back to Free tier:', path, err.message);
        onData(PLAN_CATALOG.free);
      }
    );
  }
}

export class FirebaseWebAiUsageRepository implements AiUsageRepository {
  subscribeTodayUsage(
    uid: string,
    dayKey: string,
    onData: (usage: AiUsageRecord) => void
  ): () => void {
    const path = `users/${uid}/aiUsage/${dayKey}`;
    const ref = doc(db, 'users', uid, 'aiUsage', dayKey);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          onData({ dayKey, requestCount: 0, inputTokensEst: 0, outputTokensEst: 0 });
          return;
        }
        const raw = snap.data();
        onData({
          dayKey,
          requestCount: Number(raw.requestCount ?? 0),
          inputTokensEst: Number(raw.inputTokensEst ?? 0),
          outputTokensEst: Number(raw.outputTokensEst ?? 0),
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      }
    );
  }

  async recordUsage(
    uid: string,
    dayKey: string,
    current: AiUsageRecord | null,
    inputTokensEst: number,
    outputTokensEst: number
  ): Promise<void> {
    const path = `users/${uid}/aiUsage/${dayKey}`;
    const ref = doc(db, 'users', uid, 'aiUsage', dayKey);
    try {
      if (!current || current.requestCount === 0) {
        await setDoc(ref, {
          uid,
          dayKey,
          requestCount: 1,
          inputTokensEst: Math.max(0, Math.floor(inputTokensEst)),
          outputTokensEst: Math.max(0, Math.floor(outputTokensEst)),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          requestCount: current.requestCount + 1,
          inputTokensEst: current.inputTokensEst + Math.max(0, Math.floor(inputTokensEst)),
          outputTokensEst: current.outputTokensEst + Math.max(0, Math.floor(outputTokensEst)),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

/**
 * Local-Only Document Vault adapter using browser IndexedDB (zero Cloud Storage / Blaze billing).
 */
export class IndexedDBLocalVaultAdapter implements LocalVaultStorageAdapter {
  private readonly metaKey = 'lifeos_local_vault_entries_v1';

  async listLocalEntries(): Promise<LocalVaultEntryMeta[]> {
    try {
      const raw = localStorage.getItem(this.metaKey);
      return raw ? (JSON.parse(raw) as LocalVaultEntryMeta[]) : [];
    } catch {
      return [];
    }
  }

  async saveLocalEntry(meta: LocalVaultEntryMeta, payload: string): Promise<void> {
    const list = await this.listLocalEntries();
    const updated = [meta, ...list.filter((e) => e.id !== meta.id)];
    localStorage.setItem(this.metaKey, JSON.stringify(updated));
    localStorage.setItem(`lifeos_local_vault_blob_${meta.id}`, payload);
  }

  async removeLocalEntry(id: string): Promise<void> {
    const list = await this.listLocalEntries();
    localStorage.setItem(this.metaKey, JSON.stringify(list.filter((e) => e.id !== id)));
    localStorage.removeItem(`lifeos_local_vault_blob_${id}`);
  }
}

export const authRepository: AuthRepository = new FirebaseWebAuthRepository();
export const userProfileRepository: UserProfileRepository = new FirebaseWebUserProfileRepository();
export const aiUsageRepository: AiUsageRepository = new FirebaseWebAiUsageRepository();
export const localVaultAdapter: LocalVaultStorageAdapter = new IndexedDBLocalVaultAdapter();
