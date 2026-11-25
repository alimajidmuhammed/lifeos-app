import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { ThemeMode } from '../../state/useUIStore';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function hapticLight(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Ignore on unsupported devices
  }
}

export async function hapticMedium(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    // Ignore
  }
}

export async function hapticSuccess(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Ignore
  }
}

export async function syncNativeStatusBar(theme: ThemeMode): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (theme === 'light') {
      await StatusBar.setStyle({ style: Style.Light });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
      }
    } else if (theme === 'amoled') {
      await StatusBar.setStyle({ style: Style.Dark });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#000000' });
      }
    } else {
      await StatusBar.setStyle({ style: Style.Dark });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#131C31' });
      }
    }
  } catch {
    // Ignore if StatusBar plugin is unavailable
  }
}

/**
 * Handles Android hardware back button:
 * Closes open drawers/palettes first, navigates back to Home if on a sub-route,
 * or minimizes the app cleanly when already on Home.
 */
export function registerNativeBackHandler(getHandlers: () => {
  commandPaletteOpen: boolean;
  mobileMoreOpen: boolean;
  activeRoute: string;
  closeCommandPalette: () => void;
  closeMobileMore: () => void;
  goHome: () => void;
}): () => void {
  if (!isNativeApp()) return () => {};

  let listenerHandle: { remove: () => Promise<void> } | null = null;
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const state = getHandlers();
    if (state.commandPaletteOpen) {
      state.closeCommandPalette();
      return;
    }
    if (state.mobileMoreOpen) {
      state.closeMobileMore();
      return;
    }
    if (state.activeRoute !== 'home') {
      state.goHome();
      return;
    }
    if (canGoBack) {
      window.history.back();
    } else {
      void CapacitorApp.minimizeApp();
    }
  }).then((handle) => {
    listenerHandle = handle;
  });

  return () => {
    void listenerHandle?.remove();
  };
}
