/** True when nothing holds focus (it fell to `<body>`), so moving it loses nothing. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return active == null || active === document.body;
}

/**
 * The control to give focus back to after a dialog that `el` opened: `el`
 * itself, or for an item of a row menu, the button that opened that menu
 * (the item is gone once the menu closes).
 */
export function focusOpener(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  const menu = el.closest<HTMLElement>('[role="menu"]');
  if (!menu) return el;
  if (!menu.id) return null;
  const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`);
  if (!trigger || trigger.matches('button')) return trigger;
  return trigger.querySelector<HTMLElement>('button') ?? trigger;
}

const FORM_CONTROL =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"])';

/** The first invalid control of a form, else its first field, to give focus back to. */
export function firstFormField(container: ParentNode | null): HTMLElement | null {
  if (!container) return null;
  return (
    container.querySelector<HTMLElement>(`[aria-invalid="true"]:is(${FORM_CONTROL})`) ??
    container.querySelector<HTMLElement>(FORM_CONTROL)
  );
}

/**
 * The configuration page's open tab: where focus goes once a dialog closes
 * after the control that opened it went away (Save or Revert removes its
 * button), so keyboard users land on the page, not on `<body>`.
 */
export function activeConfigTab(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
}
