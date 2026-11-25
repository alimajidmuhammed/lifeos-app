import React, { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { AICommandPalette } from './components/AICommandPalette';
import { AppLockOverlay } from './components/AppLockOverlay';
import { HomeView } from './features/home/ui/HomeView';
import { DebtsView } from './features/debts/ui/DebtsView';
import { RemindersView } from './features/reminders/ui/RemindersView';
import { PlannerView } from './features/planner/ui/PlannerView';
import { NotesView } from './features/notes/ui/NotesView';
import { VaultView } from './features/vault/ui/VaultView';
import { HabitsView } from './features/habits/ui/HabitsView';
import { FinanceView } from './features/finance/ui/FinanceView';
import { SettingsView } from './features/settings/ui/SettingsView';
import { ModuleReadinessView } from './features/modules/ui/ModuleReadinessView';
import { useLifeOSSync } from './hooks/useLifeOS';
import { useUIStore } from './state/useUIStore';
import { registerNativeBackHandler, syncNativeStatusBar } from './core/native/mobileBridge';

function LifeOSWorkspace() {
  useLifeOSSync();
  const activeRoute = useUIStore((s) => s.activeRoute);
  const theme = useUIStore((s) => s.profile.theme);

  useEffect(() => {
    void syncNativeStatusBar(theme);
  }, [theme]);

  useEffect(() => {
    return registerNativeBackHandler(() => {
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
  }, []);

  return (
    <>
      <AppShell>
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
      </AppShell>
      <AICommandPalette />
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
