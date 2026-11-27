import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface MoreActionItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  tone?: 'default' | 'accent' | 'warn';
}

export const MoreActionsMenu: React.FC<{
  items: MoreActionItem[];
  ariaLabel?: string;
}> = ({ items, ariaLabel = 'More actions' }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const estimatedHeight = items.length * 40 + 16;
      const isRtl = document.documentElement.dir === 'rtl';
      const rawLeft = isRtl ? rect.left : rect.right - menuWidth;
      const left = Math.max(12, Math.min(rawLeft, window.innerWidth - menuWidth - 12));
      const fitsBelow = rect.bottom + 6 + estimatedHeight <= window.innerHeight - 12;
      const top = fitsBelow ? rect.bottom + 6 : Math.max(12, rect.top - 6 - estimatedHeight);
      setCoords({ top, left });
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={handleToggle}
        className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && coords && (
        <div
          role="menu"
          style={{ top: coords.top, left: coords.left, width: 220 }}
          className="fixed z-50 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1.5 shadow-lg anim-scale-in"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-xs font-medium transition-colors hover:bg-[var(--bg-subtle)] ${
                  item.tone === 'warn'
                    ? 'text-amber-700 dark:text-amber-400'
                    : item.tone === 'accent'
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-primary)]'
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
