import React, { Suspense, lazy, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { AICommandPalette } from './components/AICommandPalette';
import { AppLockOverlay } from './components/AppLockOverlay';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { SplashScreen } from './components/SplashScreen';
import { decodeLinkProfile, PublicLinkProfileView } from './features/qr/ui/PublicLinkProfileView';
import { HomeView } from './features/home/ui/HomeView';
import { useLifeOSSync } from './hooks/useLifeOS';
import { useUIStore } from './state/useUIStore';
import {
  hideNativeSplashScreen,
  registerNativeBackHandler,
  registerNativeKeyboardListener,
  syncNativeStatusBar,
} from './core/native/mobileBridge';
import {
  checkOrRequestNativeNotificationPermission,
  registerNotificationTapListener,
} from './core/reminders/nativeNotifications';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const storageKey = 'lifeos_chunk_reload';
    try {
      const mod = await importer();
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore
      }
      return mod;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isChunkErr =
        /dynamically imported module|ChunkLoadError|Loading chunk|Failed to fetch/i.test(msg);
      if (isChunkErr) {
        let alreadyReloaded = false;
        try {
          alreadyReloaded = sessionStorage.getItem(storageKey) === '1';
          if (!alreadyReloaded) {
            sessionStorage.setItem(storageKey, '1');
          }
        } catch {
          // Ignore
        }
        if (!alreadyReloaded) {
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }
  });
}

const DebtsView = lazyWithRetry(() => import('./features/debts/ui/DebtsView').then((m) => ({ default: m.DebtsView })));
const RemindersView = lazyWithRetry(() => import('./features/reminders/ui/RemindersView').then((m) => ({ default: m.RemindersView })));
const PlannerView = lazyWithRetry(() => import('./features/planner/ui/PlannerView').then((m) => ({ default: m.PlannerView })));
const NotesView = lazyWithRetry(() => import('./features/notes/ui/NotesView').then((m) => ({ default: m.NotesView })));
const VaultView = lazyWithRetry(() => import('./features/vault/ui/VaultView').then((m) => ({ default: m.VaultView })));
const HabitsView = lazyWithRetry(() => import('./features/habits/ui/HabitsView').then((m) => ({ default: m.HabitsView })));
const FinanceView = lazyWithRetry(() => import('./features/finance/ui/FinanceView').then((m) => ({ default: m.FinanceView })));
const QRCodeView = lazyWithRetry(() => import('./features/qr/ui/QRCodeView').then((m) => ({ default: m.QRCodeView })));
const SettingsView = lazyWithRetry(() => import('./features/settings/ui/SettingsView').then((m) => ({ default: m.SettingsView })));
const ModuleReadinessView = lazyWithRetry(() => import('./features/modules/ui/ModuleReadinessView').then((m) => ({ default: m.ModuleReadinessView })));

const RouteFallback = () => (
  <div className="flex items-center justify-center py-20">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--border-hairline)] border-t-[var(--accent)]" />
  </div>
);

function LifeOSWorkspace() {
  useLifeOSSync();
  const activeRoute = useUIStore((s) => s.activeRoute);
  const theme = useUIStore((s) => s.profile.theme);

  useEffect(() => {
    void hideNativeSplashScreen();
    void checkOrRequestNativeNotificationPermission();
  }, []);

  useEffect(() => {
    void syncNativeStatusBar(theme);
  }, [theme]);

  useEffect(() => {
    const unsubBack = registerNativeBackHandler(() => {
      const s = useUIStore.getState();
      return {
        commandPaletteOpen: s.commandPaletteOpen,
        mobileMoreOpen: s.mobileMoreOpen,
        activeRoute: s.activeRoute,
        closeCommandPalette: () => s.setCommandPaletteOpen(false),
        closeMobileMore: () => s.setMobileMoreOpen(false),
        goHome: () => {
          if (!s.goBackRoute()) {
            s.setActiveRoute('home');
          }
        },
      };
    });
    const unsubKeyboard = registerNativeKeyboardListener();
    const unsubNotifTap = registerNotificationTapListener((route) => {
      useUIStore.getState().setActiveRoute(route);
    });

    return () => {
      unsubBack();
      unsubKeyboard();
      unsubNotifTap();
    };
  }, []);

  return (
    <>
      <SplashScreen />
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
          {activeRoute === 'home' ? (
            <HomeView />
          ) : activeRoute === 'debts' ? (
            <DebtsView />
          ) : activeRoute === 'reminders' ? (
            <RemindersView />
          ) : activeRoute === 'planner' ? (
            <PlannerView />
          ) : activeRoute === 'notes' ? (
            <NotesView />
          ) : activeRoute === 'vault' ? (
            <VaultView />
          ) : activeRoute === 'habits' ? (
            <HabitsView />
          ) : activeRoute === 'finance' ? (
            <FinanceView />
          ) : activeRoute === 'qr' ? (
            <QRCodeView />
          ) : activeRoute === 'settings' ? (
            <SettingsView />
          ) : (
            <ModuleReadinessView route={activeRoute} />
          )}
        </Suspense>
      </AppShell>
      <AICommandPalette />
      <NotificationCenterModal />
      <AppLockOverlay />
    </>
  );
}

export default function App() {
  const [publicToken, setPublicToken] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('profile');
  });

  const publicProfile = React.useMemo(
    () => (publicToken ? decodeLinkProfile(publicToken) : null),
    [publicToken]
  );

  if (publicProfile) {
    return (
      <ErrorBoundary>
        <PublicLinkProfileView
          profile={publicProfile}
          onOpenApp={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('profile');
            window.history.replaceState({}, '', url.toString());
            setPublicToken(null);
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <LifeOSWorkspace />
    </ErrorBoundary>
  );
}
