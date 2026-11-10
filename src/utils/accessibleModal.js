/**
 * Accessible Modal & Focus Management Utility (REM-P2-06 & Addendum 8)
 *
 * Implements:
 * 1. Focus trap (Tab / Shift+Tab cycling).
 * 2. Focus restoration to triggering element on modal dismiss.
 * 3. Escape key listener with active operation blocking:
 *    When isProcessing=true, Escape is BLOCKED to prevent accidental abort of
 *    payments, cash closing, or irreversible transactions.
 * 4. Screen reader announcements via aria-live.
 */

export function setupAccessibleModal({
  modalElement,
  triggerElement = null,
  onClose,
  isProcessing = false,
  liveRegionElement = null
}) {
  if (!modalElement) return () => {};

  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = Array.from(modalElement.querySelectorAll(focusableSelector))
    .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);

  const firstFocusable = focusableElements[0] || modalElement;
  const lastFocusable = focusableElements[focusableElements.length - 1] || modalElement;

  // Set initial focus
  setTimeout(() => {
    if (firstFocusable && typeof firstFocusable.focus === 'function') {
      firstFocusable.focus();
    }
  }, 50);

  function announce(message, priority = 'polite') {
    if (liveRegionElement) {
      liveRegionElement.setAttribute('aria-live', priority);
      liveRegionElement.textContent = message;
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (isProcessing) {
        e.preventDefault();
        e.stopPropagation();
        announce('Operación en proceso. Por seguridad, no es posible cerrar la ventana en este momento.', 'assertive');
        return;
      }
      e.preventDefault();
      if (typeof onClose === 'function') {
        onClose();
      }
      return;
    }

    if (e.key === 'Tab') {
      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }
  }

  modalElement.addEventListener('keydown', handleKeyDown);

  // Return cleanup teardown that restores focus to original trigger
  return function teardown() {
    modalElement.removeEventListener('keydown', handleKeyDown);
    if (triggerElement && typeof triggerElement.focus === 'function') {
      try {
        triggerElement.focus();
      } catch (_) {}
    }
  };
}
