import { useEffect, useState } from 'react';
import {
  aiUsageRepository,
  authRepository,
  userProfileRepository,
} from '../data/repositories/firebaseWebAdapter';
import { testFirestoreConnection } from '../data/firebase/firebaseClient';
import { getTodayDayKey } from '../core/entitlements/entitlements';
import { useUIStore } from '../state/useUIStore';
import type { UserProfileData } from '../core/schemas/userProfileSchema';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Bootstraps Firebase connectivity check, Auth listener, and real-time Firestore listeners
 * strictly scoped under users/{uid}/... when authenticated.
 */
export function useLifeOSSync() {
  const setAuthState = useUIStore((s) => s.setAuthState);
  const setProfile = useUIStore((s) => s.setProfile);
  const setEntitlements = useUIStore((s) => s.setEntitlements);
  const setTodayAiUsage = useUIStore((s) => s.setTodayAiUsage);

  useEffect(() => {
    void testFirestoreConnection();

    let unsubProfile: (() => void) | null = null;
    let unsubEntitlements: (() => void) | null = null;
    let unsubUsage: (() => void) | null = null;

    const cleanupDataListeners = () => {
      unsubProfile?.();
      unsubEntitlements?.();
      unsubUsage?.();
      unsubProfile = null;
      unsubEntitlements = null;
      unsubUsage = null;
    };

    const unsubAuth = authRepository.onAuthStateChanged(async (user) => {
      cleanupDataListeners();
      setAuthState(user, true);

      if (!user) return;

      try {
        const ensured = await userProfileRepository.ensureProfile(user);
        setProfile(ensured);
      } catch (err) {
        console.error('Failed to ensure Firestore user profile:', err);
      }

      unsubProfile = userProfileRepository.subscribeProfile(user.uid, (prof) => {
        setProfile(prof);
      });

      unsubEntitlements = userProfileRepository.subscribeEntitlements(user.uid, (ent) => {
        setEntitlements(ent);
      });

      const dayKey = getTodayDayKey();
      unsubUsage = aiUsageRepository.subscribeTodayUsage(user.uid, dayKey, (usage) => {
        setTodayAiUsage(usage);
      });
    });

    return () => {
      cleanupDataListeners();
      unsubAuth();
    };
  }, [setAuthState, setProfile, setEntitlements, setTodayAiUsage]);
}

/**
 * Persists a profile patch optimistically to local cache and atomically to Firestore when signed in.
 */
export async function persistProfilePatch(patch: Partial<UserProfileData>): Promise<void> {
  const state = useUIStore.getState();
  const prev = state.profile;
  state.patchLocalProfile(patch);
  if (state.authUser) {
    try {
      await userProfileRepository.updateProfile(state.authUser.uid, prev, patch);
    } catch (err) {
      console.error('Cloud profile update failed (local offline cache preserved):', err);
    }
  }
}
