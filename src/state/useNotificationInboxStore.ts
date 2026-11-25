import { create } from 'zustand';

export type InboxNotificationSource = 'reminder' | 'debt' | 'system' | 'native';

export interface InboxNotificationItem {
  id: string;
  title: string;
  body: string;
  createdAtIso: string;
  source: InboxNotificationSource;
  route: 'reminders' | 'debts' | 'home';
}

const READ_IDS_KEY = 'lifeos_notif_read_ids_v1';
const CUSTOM_ITEMS_KEY = 'lifeos_notif_custom_v1';

function loadReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // Ignore storage errors
  }
  return [];
}

function saveReadIds(ids: string[]): void {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Ignore
  }
}

function loadCustomItems(): InboxNotificationItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ITEMS_KEY);
    if (raw) return JSON.parse(raw) as InboxNotificationItem[];
  } catch {
    // Ignore
  }
  return [];
}

function saveCustomItems(items: InboxNotificationItem[]): void {
  try {
    localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Ignore
  }
}

interface NotificationInboxState {
  open: boolean;
  readIds: string[];
  customItems: InboxNotificationItem[];
  setOpen: (open: boolean) => void;
  markRead: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  pushNotification: (item: Omit<InboxNotificationItem, 'createdAtIso'> & { createdAtIso?: string }) => void;
  clearCustom: () => void;
}

export const useNotificationInboxStore = create<NotificationInboxState>((set, get) => ({
  open: false,
  readIds: typeof window !== 'undefined' ? loadReadIds() : [],
  customItems: typeof window !== 'undefined' ? loadCustomItems() : [],

  setOpen: (open) => set({ open }),

  markRead: (id) => {
    const prev = get().readIds;
    if (prev.includes(id)) return;
    const next = [...prev, id].slice(-200);
    saveReadIds(next);
    set({ readIds: next });
  },

  markAllRead: (ids) => {
    const merged = Array.from(new Set([...get().readIds, ...ids])).slice(-200);
    saveReadIds(merged);
    set({ readIds: merged });
  },

  pushNotification: (item) => {
    const entry: InboxNotificationItem = {
      ...item,
      createdAtIso: item.createdAtIso ?? new Date().toISOString(),
    };
    const prev = get().customItems.filter((x) => x.id !== entry.id);
    const next = [entry, ...prev].slice(0, 50);
    saveCustomItems(next);
    set({ customItems: next });
  },

  clearCustom: () => {
    saveCustomItems([]);
    set({ customItems: [] });
  },
}));
