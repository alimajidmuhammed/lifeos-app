import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
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

export async function hideNativeSplashScreen(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // Ignore if unavailable
  }
}

export function registerNativeKeyboardListener(): () => void {
  if (!isNativeApp()) return () => {};

  let showHandle: { remove: () => Promise<void> } | null = null;
  let hideHandle: { remove: () => Promise<void> } | null = null;

  void Keyboard.addListener('keyboardWillShow', () => {
    document.body.classList.add('keyboard-open');
  }).then((h) => {
    showHandle = h;
  });

  void Keyboard.addListener('keyboardWillHide', () => {
    document.body.classList.remove('keyboard-open');
  }).then((h) => {
    hideHandle = h;
  });

  return () => {
    document.body.classList.remove('keyboard-open');
    void showHandle?.remove();
    void hideHandle?.remove();
  };
}

export async function captureNativePhotoDataUrl(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
    });
    return photo.dataUrl ?? null;
  } catch {
    return null;
  }
}

export function registerNativeAppResumeListener(onResume: () => void): () => void {
  if (!isNativeApp()) return () => {};

  let handle: { remove: () => Promise<void> } | null = null;
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) onResume();
  }).then((h) => {
    handle = h;
  });

  return () => {
    void handle?.remove();
  };
}

/**
 * Exports a JSON string using native Filesystem + Share sheet on Android/iOS,
 * falling back to a browser download blob on Web.
 */
export async function exportJsonNativeOrWeb(
  filename: string,
  jsonText: string
): Promise<'native' | 'web'> {
  if (isNativeApp()) {
    try {
      await Filesystem.writeFile({
        path: filename,
        data: jsonText,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const { uri } = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache,
      });
      await Share.share({
        title: filename,
        text: 'LifeinOne Workspace Backup',
        url: uri,
        dialogTitle: 'Export LifeinOne Backup',
      });
      return 'native';
    } catch {
      // Fall through to web download fallback if native share is cancelled or unavailable
    }
  }

  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'web';
}

export async function shareTextNativeOrWeb(title: string, text: string): Promise<boolean> {
  if (isNativeApp()) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
