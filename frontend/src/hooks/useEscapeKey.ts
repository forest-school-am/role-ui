import { useEffect } from 'react';

/**
 * Calls `onClose` whenever the Escape key is pressed.
 */
export function useEscapeKey(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}
