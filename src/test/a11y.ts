/** Elements a user operates, by tag or role. */
const CONTROLS =
  'a[href], button, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [role="tab"]';
/** Elements that can take focus, even out of the tab order (`tabindex="-1"`). */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function describeElement(el: Element): string {
  const role = el.getAttribute('role');
  const name = el.getAttribute('aria-label') ?? el.id;
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}${name ? ` "${name}"` : ''}`;
}

/**
 * Each control under `root` that holds another focusable element, as axe's
 * nested-interactive rule reports it ("the switch inside the header button").
 * An inert descendant cannot take focus, so it does not count.
 */
export function nestedControls(root: Element): string[] {
  return [...root.querySelectorAll(CONTROLS)].flatMap((control) => {
    const inner = [...control.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
    return inner.map((el) => `${describeElement(el)} inside ${describeElement(control)}`);
  });
}
