import { useContext, useLayoutEffect } from 'react';
import type * as t from '@/types';
import { SoleFieldContext } from '@/contexts/SettingsContext';
import { SectionControls } from './SectionControls';
import { SectionHeader } from './SectionHeader';
import { useLocalize } from '@/hooks';

const LABELABLE = 'input, textarea, select, button, [role="switch"], [role="combobox"]';

/**
 * Names the control after its section in a single-field section: the visible
 * label is the section heading, so `aria-labelledby` (which outranks the
 * control's own `aria-label`) points at "<Section> <field>". Runs after every
 * render because controls can remount without the row re-rendering.
 */
function useSoleFieldName(htmlFor: string | undefined, nameId: string) {
  useLayoutEffect(() => {
    if (!htmlFor) return;
    const target = document.getElementById(htmlFor);
    const control = target?.matches(LABELABLE)
      ? target
      : target?.querySelector<HTMLElement>(LABELABLE);
    if (!control || control.hasAttribute('aria-labelledby')) return;
    control.setAttribute('aria-labelledby', nameId);
    return () => control.removeAttribute('aria-labelledby');
  });
}

/**
 * Ties a row's error to its control (`aria-describedby`, and `aria-invalid`
 * unless the control already says so), for errors the row shows on the
 * control's behalf (save pipeline issues, spec problems). A control that also
 * shows its own message stays described by both.
 */
function useErrorDescription(htmlFor: string | undefined, hasError: boolean) {
  useLayoutEffect(() => {
    if (!htmlFor || !hasError) return;
    const target = document.getElementById(htmlFor);
    const control = target?.matches(LABELABLE)
      ? target
      : target?.querySelector<HTMLElement>(LABELABLE);
    if (!control) return;
    const errorId = `${htmlFor}-error`;
    const setsInvalid = control.getAttribute('aria-invalid') !== 'true';
    const described = control.getAttribute('aria-describedby')?.split(' ') ?? [];
    const addsDescription = !described.includes(errorId);
    if (setsInvalid) control.setAttribute('aria-invalid', 'true');
    /**
     * Writes to `aria-invalid` after ours are the control's own (React
     * rendering its own error as the row's goes away), so they hand the
     * attribute back to the control. Read synchronously in the cleanup.
     */
    const claims = setsInvalid ? new MutationObserver(() => undefined) : null;
    claims?.observe(control, { attributes: true, attributeFilter: ['aria-invalid'] });
    if (addsDescription) {
      control.setAttribute('aria-describedby', [...described, errorId].join(' '));
    }
    /**
     * Undo only what this effect added, against the attributes as they are
     * now: React may have updated them since (a rename warning that went
     * away), and restoring a snapshot would bring back a stale id.
     */
    return () => {
      const reclaimed = (claims?.takeRecords().length ?? 0) > 0;
      claims?.disconnect();
      if (setsInvalid && !reclaimed && control.getAttribute('aria-invalid') === 'true') {
        control.removeAttribute('aria-invalid');
      }
      if (!addsDescription) return;
      const remaining = (control.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((id) => id !== '' && id !== errorId);
      if (remaining.length > 0) control.setAttribute('aria-describedby', remaining.join(' '));
      else control.removeAttribute('aria-describedby');
    };
  });
}

function SoleFieldRow({ sole, label, htmlFor, children }: t.SoleFieldRowProps) {
  const localize = useLocalize();
  const nameId = `${sole.headingId}-field`;
  useSoleFieldName(htmlFor, nameId);
  const sameLabel = label.trim().toLowerCase() === sole.sectionTitle.trim().toLowerCase();
  const name = sameLabel
    ? sole.sectionTitle
    : localize('com_config_ui_sole_name', { section: sole.sectionTitle, field: label });

  return (
    <div className="settings-row-sole">
      <span id={nameId} hidden>
        {name}
      </span>
      {children}
    </div>
  );
}

/**
 * One settings row on the shared grid `label | control | trailing` (WS6).
 * WS3 fills the slots; the layout, type scale and responsive collapse live here
 * and in `styles.css` (`.settings-row`). Inside a single-field section the row
 * drops its label column and lends its cells to the section's header row.
 */
export function SettingsRow({
  label,
  htmlFor,
  description,
  learnMoreUrl,
  control,
  chips,
  hint,
  actions,
  error,
  required,
  width,
  marker,
}: t.SettingsRowProps) {
  const sole = useContext(SoleFieldContext);
  useErrorDescription(htmlFor, Boolean(error));
  const errorNode = error ? (
    <div id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="settings-error">
      {error}
    </div>
  ) : null;
  const trailing =
    chips || actions ? (
      <div className="settings-row-trailing">
        {chips}
        {actions}
      </div>
    ) : null;

  if (sole) {
    return (
      <SoleFieldRow sole={sole} label={label} htmlFor={htmlFor}>
        <SectionControls width={width}>
          {control}
          {hint}
          {errorNode}
        </SectionControls>
        {trailing}
      </SoleFieldRow>
    );
  }

  return (
    <div className="settings-row" data-marker={marker}>
      <SectionHeader
        title={label}
        description={description}
        learnMoreUrl={learnMoreUrl}
        htmlFor={htmlFor}
        required={required}
        subtitle={hint}
      />
      <SectionControls width={width}>
        {control}
        {errorNode}
      </SectionControls>
      {trailing}
    </div>
  );
}
