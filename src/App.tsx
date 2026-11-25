import React, { Suspense, lazy, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { AICommandPalette } from './components/AICommandPalette';
import { AppLockOverlay } from './components/AppLockOverlay';
import { NotificationCenterModal } from './components/NotificationCenterModal';
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

const DebtsView = lazy(() => import('./features/debts/ui/DebtsView').then((m) => ({ default: m.DebtsView })));
const RemindersView = lazy(() => import('./features/reminders/ui/RemindersView').then((m) => ({ default: m.RemindersView })));
const PlannerView = lazy(() => import('./features/planner/ui/PlannerView').then((m) => ({ default: m.PlannerView })));
const NotesView = lazy(() => import('./features/notes/ui/NotesView').then((m) => ({ default: m.NotesView })));
const VaultView = lazy(() => import('./features/vault/ui/VaultView').then((m) => ({ default: m.VaultView })));
const HabitsView = lazy(() => import('./features/habits/ui/HabitsView').then((m) => ({ default: m.HabitsView })));
const FinanceView = lazy(() => import('./features/finance/ui/FinanceView').then((m) => ({ default: m.FinanceView })));
const SettingsView = lazy(() => import('./features/settings/ui/SettingsView').then((m) => ({ default: m.SettingsView })));
const ModuleReadinessView = lazy(() => import('./features/modules/ui/ModuleReadinessView').then((m) => ({ default: m.ModuleReadinessView })));

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
  return (
    <ErrorBoundary>
      <LifeOSWorkspace />
    </ErrorBoundary>
  );
}
