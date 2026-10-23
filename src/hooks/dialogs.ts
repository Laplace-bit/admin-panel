import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as t from '@/types';
import { focusOpener, isFocusLost, firstFormField } from '@/utils';

/** click-ui's dialog close button, named only by its icon ("cross"). */
const UNNAMED_CLOSE = '[role="dialog"] button:not([aria-label]):has(svg[aria-label="cross"])';

/**
 * Names every click-ui dialog's close button `label` ("Close"): click-ui
 * renders it without an accessible name of its own, so screen readers read
 * the icon's name. Dialogs portal into `<body>`, so only its direct children
 * are watched; each new portal is labelled once its content has rendered.
 */
export function useDialogCloseLabels(label: string): void {
  useEffect(() => {
    const labelIn = (root: ParentNode) => {
      for (const button of root.querySelectorAll<HTMLButtonElement>(UNNAMED_CLOSE)) {
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      }
    };
    labelIn(document.body);
    const observer = new MutationObserver((mutations) => {
      const added = mutations.flatMap((mutation) => [...mutation.addedNodes]);
      if (added.length === 0) return;
      requestAnimationFrame(() => {
        for (const node of added) if (node instanceof HTMLElement) labelIn(node);
      });
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [label]);
}

/**
 * Gives focus back to whatever opened a controlled dialog once it closes
 * (WCAG 2.4.3). Radix returns focus to its own trigger, which these dialogs
 * don't have, so it would land on `<body>`. Pass the handler as the content's
 * `onCloseAutoFocus`; focus an action already moved (to a new row, a field)
 * is left where it is. When the dialog's action removed its opener (Save
 * removes "Review & save"), focus goes to `fallback()` instead.
 */
export function useReturnFocus(
  open: boolean,
  fallback?: () => HTMLElement | null,
): (event: Event) => void {
  const openerRef = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useLayoutEffect(() => {
    if (open) openerRef.current = focusOpener(document.activeElement);
  }, [open]);
  return useCallback((event: Event) => {
    event.preventDefault();
    const opener = openerRef.current;
    openerRef.current = null;
    if (!isFocusLost()) return;
    const target = opener?.isConnected ? opener : fallbackRef.current?.();
    target?.focus();
  }, []);
}

/**
 * The "Discard this new …?" prompt of a create form (FormDialog, Create
 * endpoint). `request()` asks first; asked again (a second Escape, the close
 * button) it keeps editing, so only Discard throws the draft away. Keep
 * editing gives focus back to the field the admin was in, else the form's
 * first invalid or first field (`formRef`).
 */
export function useDiscardPrompt(): t.DiscardPromptState {
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLElement | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef(false);
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;

  useEffect(() => {
    if (confirming || !restoreRef.current) return;
    restoreRef.current = false;
    const field = returnRef.current;
    returnRef.current = null;
    const target = field?.isConnected ? field : firstFormField(formRef.current);
    target?.focus();
  }, [confirming]);

  const keep = useCallback(() => {
    restoreRef.current = true;
    setConfirming(false);
  }, []);
  const request = useCallback(() => {
    if (confirmingRef.current) {
      keep();
      return;
    }
    const active = document.activeElement;
    returnRef.current =
      active instanceof HTMLElement && formRef.current?.contains(active) ? active : null;
    setConfirming(true);
  }, [keep]);
  const dismiss = useCallback(() => {
    returnRef.current = null;
    restoreRef.current = false;
    setConfirming(false);
  }, []);

  return { confirming, formRef, request, keep, dismiss };
}
