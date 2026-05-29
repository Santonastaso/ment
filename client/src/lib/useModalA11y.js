import { useEffect, useRef } from 'react';

// Shared dialog accessibility helper.
// - Moves initial focus into the dialog on mount.
// - Traps Tab / Shift+Tab within the dialog.
// - Restores focus to the previously-focused element on unmount.
// - Locks body scroll while the dialog is open.
//
// Returns a ref to attach to the dialog container element.
// Escape handling and backdrop clicks stay with the caller so each modal can
// decide whether dismissal is allowed (e.g. blocked while a request is in
// flight).
export function useModalA11y() {
  const containerRef = useRef(null);

  useEffect(() => {
    const node = containerRef.current;
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;

    const FOCUSABLE = [
      'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
      'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    function focusables() {
      if (!node) return [];
      return Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
    }

    // Initial focus: first focusable element, else the container itself.
    const initial = focusables()[0];
    if (initial) {
      initial.focus();
    } else if (node) {
      node.setAttribute('tabindex', '-1');
      node.focus();
    }

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  return containerRef;
}
