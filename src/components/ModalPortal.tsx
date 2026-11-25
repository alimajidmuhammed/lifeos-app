import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: React.ReactNode;
  onClose?: () => void;
}

/**
 * Renders modal/dialog overlays directly into document.body so they escape
 * ancestor CSS transforms/stacking contexts, cover the full viewport, lock
 * background scroll, and dismiss cleanly on Escape.
 */
export const ModalPortal: React.FC<ModalPortalProps> = ({ children, onClose }) => {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};
