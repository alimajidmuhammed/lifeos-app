import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookText,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Flame,
  FolderLock,
  Home,
  LayoutGrid,
  Lock,
  LogIn,
  LogOut,
  Settings,
  Sparkles,
  Wallet,
  Scale,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore, type NavRoute } from '../state/useUIStore';
import { useOnlineStatus } from '../hooks/useLifeOS';
import { authRepository } from '../data/repositories/firebaseWebAdapter';
import { hapticLight, hapticMedium } from '../core/native/mobileBridge';
import { useAllInboxNotifications } from './NotificationCenterModal';
import { useNotificationInboxStore } from '../state/useNotificationInboxStore';
import { PWAInstallButton } from './PWAInstallButton';

interface NavItem {
  id: NavRoute;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  phase?: number;
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'debts', labelKey: 'nav.debts', icon: Scale },
  { id: 'reminders', labelKey: 'nav.reminders', icon: Bell },
  { id: 'planner', labelKey: 'nav.planner', icon: CheckSquare },
  { id: 'notes', labelKey: 'nav.notes', icon: BookText },
  { id: 'vault', labelKey: 'nav.vault', icon: FolderLock },
  { id: 'habits', labelKey: 'nav.habits', icon: Flame },
  { id: 'finance', labelKey: 'nav.finance', icon: Wallet },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
];

const MOBILE_PRIMARY_TABS: NavRoute[] = ['home', 'debts', 'reminders', 'vault'];

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const activeRoute = useUIStore((s) => s.activeRoute);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);
  const goBackRoute = useUIStore((s) => s.goBackRoute);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const mobileMoreOpen = useUIStore((s) => s.mobileMoreOpen);
  const setMobileMoreOpen = useUIStore((s) => s.setMobileMoreOpen);
  const authUser = useUIStore((s) => s.authUser);
  const pinEnabled = useUIStore((s) => s.pinEnabled);
  const lockApp = useUIStore((s) => s.lockApp);
  const toast = useUIStore((s) => s.toast);
  const dismissToast = useUIStore((s) => s.dismissToast);
  const showToast = useUIStore((s) => s.showToast);

  const isOnline = useOnlineStatus();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lifeos_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lifeos_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // Ignore
      }
      return next;
    });
  };
  const { unreadCount } = useAllInboxNotifications();
  const notifOpen = useNotificationInboxStore((s) => s.open);
  const setNotifOpen = useNotificationInboxStore((s) => s.setOpen);

  // ── Left-Edge Swipe-Back Gesture (works on Mobile Touch & Web Pointer) ──
  const [swipeProgress, setSwipeProgress] = useState(0); // 0..1
  const swipeStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lockedAxis: 'none' | 'horizontal' | 'vertical';
  }>({ active: false, startX: 0, startY: 0, lockedAxis: 'none' });

  useEffect(() => {
    const EDGE_PX = 36;
    const TRIGGER_PX = 76;

    const triggerBackAction = () => {
      void hapticLight();
      if (notifOpen) {
        setNotifOpen(false);
        return;
      }
      if (mobileMoreOpen) {
        setMobileMoreOpen(false);
        return;
      }
      if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
        return;
      }
      if (!goBackRoute() && window.history.length > 1) {
        window.history.back();
      }
    };

    const onStart = (x: number, y: number) => {
      if (x <= EDGE_PX) {
        swipeStateRef.current = { active: true, startX: x, startY: y, lockedAxis: 'none' };
      }
    };

    const onMove = (x: number, y: number) => {
      const st = swipeStateRef.current;
      if (!st.active) return;
      const dx = x - st.startX;
      const dy = Math.abs(y - st.startY);

      if (st.lockedAxis === 'none') {
        if (Math.abs(dx) > 10 || dy > 10) {
          st.lockedAxis = dx > dy * 1.25 ? 'horizontal' : 'vertical';
        }
      }
      if (st.lockedAxis === 'vertical') {
        st.active = false;
        setSwipeProgress(0);
        return;
      }
      if (st.lockedAxis === 'horizontal' && dx > 0) {
        setSwipeProgress(Math.min(1, dx / TRIGGER_PX));
      }
    };

    const onEnd = (x: number) => {
      const st = swipeStateRef.current;
      if (!st.active) return;
      const dx = x - st.startX;
      const shouldTrigger = st.lockedAxis === 'horizontal' && dx >= TRIGGER_PX;
      st.active = false;
      setSwipeProgress(0);
      if (shouldTrigger) {
        triggerBackAction();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (touch) onEnd(touch.clientX);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      onStart(e.clientX, e.clientY);
    };
    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const handleMouseUp = (e: MouseEvent) => onEnd(e.clientX);

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [notifOpen, setNotifOpen, mobileMoreOpen, commandPaletteOpen, setMobileMoreOpen, setCommandPaletteOpen, goBackRoute]);

  // ── Global Keyboard Shortcuts ──
  useEffect(() => {
    let pendingG = false;
    let pendingGTimer: number | undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when user is typing in an input/textarea/select/contentEditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // ⌘K / Ctrl+K already triggers command palette, but reinforce it here
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // '?' opens command palette
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // 'G' sequence (G then H -> Home, G then F -> Finance, G then D -> Debts, etc.)
      if (e.key === 'g' || e.key === 'G') {
        if (!pendingG) {
          pendingG = true;
          window.clearTimeout(pendingGTimer);
          pendingGTimer = window.setTimeout(() => {
            pendingG = false;
          }, 1000);
          return;
        }
      }

      if (pendingG) {
        pendingG = false;
        window.clearTimeout(pendingGTimer);
        const k = e.key.toLowerCase();
        if (k === 'h') { e.preventDefault(); setActiveRoute('home'); return; }
        if (k === 'd') { e.preventDefault(); setActiveRoute('debts'); return; }
        if (k === 'r') { e.preventDefault(); setActiveRoute('reminders'); return; }
        if (k === 'p') { e.preventDefault(); setActiveRoute('planner'); return; }
        if (k === 'n') { e.preventDefault(); setActiveRoute('notes'); return; }
        if (k === 'v') { e.preventDefault(); setActiveRoute('vault'); return; }
        if (k === 'b') { e.preventDefault(); setActiveRoute('habits'); return; }
        if (k === 'f') { e.preventDefault(); setActiveRoute('finance'); return; }
        if (k === 's') { e.preventDefault(); setActiveRoute('settings'); return; }
      }

      // Quick capture 'c' or 'C'
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(pendingGTimer);
    };
  }, [setActiveRoute, setCommandPaletteOpen]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeRoute]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      dismissToast();
    }, toast.onUndo ? 7000 : 4500);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  const handleGoogleSignIn = async () => {
    try {
      await authRepository.signInWithGoogle();
      showToast('Signed in with Google. Cloud Firestore sync active.');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
        showToast(`Add "${host}" to Firebase Console → Authentication → Settings → Authorized domains.`);
      } else {
        const msg = err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
        showToast(msg);
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await authRepository.signOut();
      showToast('Signed out. Local offline workspace remains available.');
    } catch {
      showToast('Could not complete sign-out.');
    }
  };

  const activeNavMeta = ALL_NAV_ITEMS.find((i) => i.id === activeRoute) ?? ALL_NAV_ITEMS[0];

  return (
    <div className="min-h-dvh flex bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Desktop / Tablet Collapsible Sidebar (256px / 72px, mirrors in RTL via logical borders/spacing) */}
      <aside
        className={`hidden lg:flex lg:shrink-0 lg:flex-col border-e border-[var(--border-hairline)] bg-[var(--bg-surface)] sticky top-0 h-dvh transition-[width] duration-200 ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[256px]'
        }`}
      >
        <div className="flex h-16 items-center justify-between px-4 border-b border-[var(--border-hairline)]">
          <button
            type="button"
            onClick={() => setActiveRoute('home')}
            className="flex items-center gap-2.5 text-start focus:outline-none min-w-0"
          >
            <img
              src="/logo.png"
              alt="LifeinOne"
              className="h-7 w-7 rounded-lg shrink-0 object-contain"
            />
            {!sidebarCollapsed && (
              <span className="font-display text-lg font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap truncate">
                {t('appName')}
              </span>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {pinEnabled && !sidebarCollapsed && (
              <button
                type="button"
                aria-label={t('settings.pinLockNowBtn')}
                onClick={lockApp}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Lock className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors"
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {ALL_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCollapsed ? t(item.labelKey) : undefined}
                onClick={() => setActiveRoute(item.id)}
                className={`w-full min-h-[44px] flex items-center ${
                  sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                } gap-3 rounded-xl py-2 text-sm font-medium btn-spring transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="flex items-center gap-3 truncate">
                  <Icon
                    key={isActive ? `${item.id}_active` : item.id}
                    className={`h-5 w-5 shrink-0 ${isActive ? 'anim-nav-active' : ''}`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{t(item.labelKey)}</span>}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Account & Install Footer */}
        <div className="border-t border-[var(--border-hairline)] p-4 space-y-3">
          <PWAInstallButton />

          {authUser ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {authUser.displayName}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <Cloud className="h-3 w-3 text-[var(--accent)] shrink-0" />
                  <span className="truncate">{t('common.syncedCloudMode')}</span>
                </div>
              </div>
              <button
                type="button"
                aria-label={t('common.signOut')}
                onClick={() => void handleSignOut()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap"
            >
              <LogIn className="h-4 w-4 text-[var(--accent)]" />
              <span>{t('common.signInGoogle')}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar: Safe-area aware sticky header */}
        <header className="sticky top-0 z-30 pt-safe border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]/90 backdrop-blur-md">
          <div className="h-[52px] lg:h-16 px-3.5 sm:px-4 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/logo.png"
              alt="LifeinOne"
              className="h-6 w-6 rounded-md lg:hidden shrink-0 object-contain"
            />
            <span className="text-sm font-medium text-[var(--text-muted)] hidden lg:inline whitespace-nowrap">
              {t('appName')}
            </span>
            <span aria-hidden="true" className="hidden lg:inline text-[var(--text-muted)]">
              /
            </span>
            <span className="text-base font-semibold text-[var(--text-primary)] truncate">
              {t(activeNavMeta.labelKey)}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Notification Center Bell with Unread Badge */}
            <button
              type="button"
              aria-label="Notifications"
              onClick={() => {
                void hapticLight();
                setNotifOpen(true);
              }}
              className="relative inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] btn-spring"
            >
              <Bell className={`h-[18px] w-[18px] ${unreadCount > 0 ? 'anim-bell-swing' : ''}`} />
              {unreadCount > 0 && (
                <span className="font-numeric absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {pinEnabled && (
              <button
                type="button"
                aria-label={t('settings.pinLockNowBtn')}
                onClick={() => {
                  void hapticMedium();
                  lockApp();
                }}
                className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-spring"
              >
                <Lock className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              aria-label={t('common.quickAction')}
              onClick={() => {
                void hapticLight();
                setCommandPaletteOpen(true);
              }}
              className="inline-flex h-9 w-9 sm:h-auto sm:w-auto sm:min-h-[40px] items-center justify-center gap-2 rounded-xl bg-[var(--accent)] sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] btn-spring transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t('common.quickAction')}</span>
              <kbd className="hidden md:inline font-numeric text-[11px] opacity-80 ms-1">⌘K</kbd>
            </button>
          </div>
          </div>
        </header>

        {/* Real Offline Connectivity Notice */}
        {!isOnline && (
          <div
            role="status"
            className="bg-amber-600 px-4 py-2 text-xs font-medium text-white flex items-center justify-center gap-2"
          >
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
            <span>{t('common.offlineBanner')}</span>
          </div>
        )}

        {/* Main Scrollable Viewport (max-w-1200px desktop, safe bottom padding on mobile) */}
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8 pb-[calc(76px+env(safe-area-inset-bottom,0px))] lg:pb-10 anim-spring-in" key={activeRoute}>
          {children}
        </main>
      </div>

      {/* Left-Edge Swipe-Back Visual Indicator */}
      {swipeProgress > 0.08 && (
        <div
          aria-hidden="true"
          className="fixed top-1/2 start-0 z-[70] -translate-y-1/2 pointer-events-none transition-transform duration-75"
          style={{
            transform: `translate(${Math.round(swipeProgress * 22)}px, -50%) scale(${0.8 + swipeProgress * 0.25})`,
            opacity: Math.min(1, swipeProgress * 1.2),
          }}
        >
          <div
            className={`h-11 w-11 rounded-full border shadow-lg flex items-center justify-center backdrop-blur-md transition-colors ${
              swipeProgress >= 1
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'bg-[var(--bg-surface)]/95 border-[var(--border-hairline)] text-[var(--text-primary)]'
            }`}
          >
            <ChevronLeft className="h-5 w-5" />
          </div>
        </div>
      )}

      {/* Mobile Bottom Tab Bar (56px height + safe-area, active pill + bold label) */}
      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]/95 backdrop-blur-md"
      >
        <div className="h-[56px] grid grid-cols-5 items-center px-1">
        {MOBILE_PRIMARY_TABS.map((tabId) => {
          const item = ALL_NAV_ITEMS.find((i) => i.id === tabId)!;
          const Icon = item.icon;
          const isActive = activeRoute === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => {
                void hapticLight();
                setActiveRoute(tabId);
              }}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors btn-spring ${
                isActive ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'
              }`}
            >
              <span
                className={`inline-flex items-center justify-center rounded-full px-3.5 py-1 transition-colors ${
                  isActive ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <Icon
                  key={isActive ? `${tabId}_m_active` : tabId}
                  className={`h-[19px] w-[19px] ${isActive ? 'anim-nav-active' : ''}`}
                />
              </span>
              <span className="truncate max-w-[64px]">{t(item.labelKey)}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            void hapticLight();
            setMobileMoreOpen(true);
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors btn-spring ${
            mobileMoreOpen || (!MOBILE_PRIMARY_TABS.includes(activeRoute))
              ? 'text-[var(--accent)] font-semibold'
              : 'text-[var(--text-muted)]'
          }`}
        >
          <span
            className={`inline-flex items-center justify-center rounded-full px-3.5 py-1 transition-colors ${
              mobileMoreOpen || (!MOBILE_PRIMARY_TABS.includes(activeRoute))
                ? 'bg-[var(--accent-soft)]'
                : ''
            }`}
          >
            <LayoutGrid className="h-[19px] w-[19px]" />
          </span>
          <span>{t('nav.more')}</span>
        </button>
        </div>
      </nav>

      {/* Mobile Drawer (Clean, elegant, full module navigation) */}
      {mobileMoreOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-slate-950/60 backdrop-blur-xs anim-modal-backdrop"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 pb-8 space-y-4 anim-bottom-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[var(--border-hairline)]" />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="LifeinOne" className="h-7 w-7 rounded-lg shrink-0 object-contain" />
                <div>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">{t('appName')}</h2>
                  <p className="text-[11px] text-[var(--text-muted)]">Personal Life Command Center</p>
                </div>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setMobileMoreOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-spring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* All 9 Modules in a Clean 3x3 Grid */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">
                Modules
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ALL_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeRoute === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveRoute(item.id);
                        setMobileMoreOpen(false);
                      }}
                      className={`min-h-[68px] flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-2.5 text-center transition-colors btn-spring ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-xs'
                          : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="text-xs font-medium truncate w-full">{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Account & App Actions */}
            <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2.5">
              <PWAInstallButton />
              
              {authUser ? (
                <div className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-canvas)] border border-[var(--border-hairline)]">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {authUser.displayName}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {authUser.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      void handleSignOut();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border-hairline)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] btn-spring"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>{t('common.signOut')}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    void handleGoogleSignIn();
                  }}
                  className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white btn-spring"
                >
                  <LogIn className="h-4 w-4" />
                  <span>{t('common.signInGoogle')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Undo / Feedback Toast */}
      {toast && (
        <div
          role="status"
          className="anim-toast-enter fixed bottom-20 lg:bottom-6 end-4 z-50 flex items-center gap-3 rounded-xl border border-[var(--border-hairline)] bg-slate-900 dark:bg-slate-800 px-4 py-3 text-xs font-medium text-white shadow-lg max-w-sm"
        >
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              type="button"
              onClick={() => {
                toast.onUndo?.();
                dismissToast();
              }}
              className="text-emerald-400 hover:text-emerald-300 font-semibold whitespace-nowrap"
            >
              {toast.undoLabel}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={dismissToast}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
