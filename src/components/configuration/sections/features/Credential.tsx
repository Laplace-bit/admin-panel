import { useId } from 'react';
import type * as t from '@/types';
import { SecretField, SecretInput } from '../../fields/SecretField';
import { FieldControl } from '../../renderer/FieldControl';
import { useLocalize, useConfigFeatures } from '@/hooks';
import { isEncryptedCredential } from '@/constants';
import { DecorativeIcon } from '@/components/shared';
import { TextField } from '../../fields/TextField';
import { credentialState } from './state';
import { cn } from '@/utils';

/** `${SERPER_API_KEY}`: how librechat.yaml references the credential's environment variable. */
function envRef(credential: t.WebSearchCredential): string {
  return `\${${credential.env}}`;
}

const TONE_CLASSES: Record<t.StatusTone, string> = {
  muted: 'text-(--settings-muted-fg)',
  ok: 'text-(--settings-success-fg)',
  warn: 'text-(--settings-warn-fg)',
};

/** States in which the credential's value is the one typed or stored here, not an environment reference. */
const LITERAL_STATES: ReadonlySet<t.CredentialStatus> = new Set(['pending', 'stored', 'set']);

/**
 * The status line of a credential: its source, and whether something is
 * wrong. Before `webSearchStoredKeys`, LibreChat resolves web search values
 * only from `${VAR}` references, so a value typed or stored here is ignored.
 */
function statusLine(
  state: t.CredentialState,
  credential: t.WebSearchCredential,
  serviceName: string,
  inUse: boolean,
  storedKeysUsed: boolean,
  localize: t.LocalizeFn,
): t.CredentialStatusLine | null {
  const encrypted = isEncryptedCredential(credential, { webSearchStoredKeys: storedKeysUsed });
  if (!storedKeysUsed && LITERAL_STATES.has(state.status)) {
    return {
      tone: 'warn',
      icon: 'warning',
      text: localize('com_config_features_cred_env_only', { ref: envRef(credential) }),
    };
  }
  switch (state.status) {
    case 'pending':
      return encrypted
        ? { tone: 'muted', icon: 'lock', text: localize('com_config_features_cred_pending') }
        : {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_plaintext', { ref: envRef(credential) }),
          };
    case 'stored':
      return { tone: 'ok', icon: 'lock', text: localize('com_config_features_cred_stored') };
    case 'env':
      return {
        tone: 'ok',
        icon: 'key',
        text: localize('com_config_features_cred_env', { env: state.env ?? credential.env }),
      };
    case 'default':
      return {
        tone: 'muted',
        icon: 'key',
        text: localize('com_config_features_cred_default', { env: state.env ?? credential.env }),
      };
    case 'set':
      return credential.secret && !encrypted
        ? {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_plaintext', { ref: envRef(credential) }),
          }
        : null;
    case 'missing':
      return inUse && credential.required
        ? {
            tone: 'warn',
            icon: 'warning',
            text: localize('com_config_features_cred_missing', {
              service: serviceName,
              ref: envRef(credential),
            }),
          }
        : { tone: 'muted', icon: 'key', text: localize('com_config_features_cred_unset') };
    default:
      return null;
  }
}

/**
 * A web search credential (FX-2): the key or URL a service reads, with where
 * its value comes from. A stored key shows only its masked preview with
 * Replace; a typed key is masked; an environment reference is shown as is.
 * The status line says whether the value is read from an environment
 * variable, stored encrypted, queued, or missing for a selected service.
 */
export function CredentialControl({
  credential,
  serviceName,
  inUse,
  ...props
}: t.CredentialControlProps) {
  const localize = useLocalize();
  const { webSearchStoredKeys } = useConfigFeatures();
  const statusId = useId();
  if (props.disabled) return <FieldControl {...props} />;
  const state = credentialState({ ...props, credential });
  const line = statusLine(state, credential, serviceName, inUse, webSearchStoredKeys, localize);
  const text = typeof props.value === 'string' ? props.value : '';
  const placeholder = localize(
    credential.secret
      ? 'com_config_features_cred_key_placeholder'
      : 'com_config_features_cred_url_placeholder',
    { ref: envRef(credential) },
  );
  const describedBy = line ? statusId : undefined;

  const input = (() => {
    if (credential.secret && props.secretPreview != null && props.onCancelSecret) {
      return (
        <SecretField
          id={props.id}
          value={text}
          maskedValue={props.secretPreview}
          onChange={props.onChange}
          onCancel={props.onCancelSecret}
          onRemove={props.fieldDefault.hasOwnValue ? props.onClear : undefined}
          hasPendingEdit={props.hasPendingEdit}
          width="L"
          aria-label={props.label}
        />
      );
    }
    if (credential.secret) {
      return (
        <SecretInput
          id={props.id}
          value={text}
          onChange={props.onChange}
          onClear={props.onClear}
          placeholder={placeholder}
          width="L"
          aria-label={props.label}
          aria-describedby={describedBy}
        />
      );
    }
    return (
      <TextField
        id={props.id}
        value={text}
        onChange={props.onChange}
        onClear={props.onClear}
        placeholder={placeholder}
        width="L"
        aria-label={props.label}
        aria-describedby={describedBy}
      />
    );
  })();

  return (
    <div className="flex w-full flex-col gap-1">
      {input}
      {line && (
        <span
          id={statusId}
          className={cn('flex items-start gap-1.5 text-xs', TONE_CLASSES[line.tone])}
        >
          <span className="mt-px flex shrink-0">
            <DecorativeIcon name={line.icon} size="xs" />
          </span>
          <span>{line.text}</span>
        </span>
      )}
    </div>
  );
}
