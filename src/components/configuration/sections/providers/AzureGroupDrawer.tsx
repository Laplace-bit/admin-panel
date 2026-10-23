import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { CloseButton } from '@/components/shared';
import { formatConfigValue } from '../../values';
import { maskCredential } from './azure';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="azure-drawer-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Credential({ value }: { value: string | undefined }) {
  const localize = useLocalize();
  const credential = maskCredential(value);
  if (credential.kind === 'env') {
    return <>{localize('com_config_providers_azure_env', { name: credential.name })}</>;
  }
  if (credential.kind === 'masked') return <>{localize('com_config_providers_azure_masked')}</>;
  return <span className="azure-muted">{localize('com_config_providers_azure_none')}</span>;
}

/**
 * Details of one Azure OpenAI group (AP-1), read-only: connection, version,
 * headers and parameters, and its models with their deployments. The API
 * key and header values are never shown; an environment reference is named.
 */
export function AzureGroupDrawer({
  group: openGroup,
  onClose,
  returnFocus,
}: t.AzureGroupDrawerProps) {
  const localize = useLocalize();
  /** The last group shown, kept while the drawer animates closed. */
  const [group, setGroup] = useState(openGroup);
  if (openGroup && openGroup !== group) setGroup(openGroup);
  const none = <span className="azure-muted">{localize('com_config_providers_azure_none')}</span>;
  const yesNo = (on: boolean) =>
    localize(on ? 'com_config_providers_azure_yes' : 'com_config_providers_azure_no');
  const inherits = (
    <span className="azure-muted">{localize('com_config_providers_azure_inherits')}</span>
  );

  return (
    <Dialog.Root open={openGroup != null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus?.current?.focus();
          }}
          className={cn(
            'fixed top-0 right-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl sm:w-xl',
            'border-l border-(--cui-color-stroke-default)',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          {group && (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Dialog.Title className="m-0 text-base font-semibold break-all text-(--cui-color-text-default)">
                    {group.group}
                  </Dialog.Title>
                  <Dialog.Description className="m-0 text-xs text-(--cui-color-text-muted)">
                    {localize('com_config_providers_azure_drawer_desc')}
                  </Dialog.Description>
                </div>
                <CloseButton
                  label={localize('com_config_providers_azure_close')}
                  onClick={onClose}
                />
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
                <dl className="azure-drawer-list">
                  <Item label={localize('com_config_providers_azure_field_apiKey')}>
                    <Credential value={group.apiKey} />
                  </Item>
                  <Item label={localize('com_config_providers_azure_field_serverless')}>
                    {yesNo(group.serverless)}
                  </Item>
                  {group.serverless ? (
                    <Item label={localize('com_config_providers_azure_field_baseURL')}>
                      <span className="break-all">{group.baseURL ?? none}</span>
                    </Item>
                  ) : (
                    <Item label={localize('com_config_providers_azure_field_instance')}>
                      {group.instanceName ?? none}
                    </Item>
                  )}
                  {!group.serverless && group.baseURL && (
                    <Item label={localize('com_config_providers_azure_field_baseURL')}>
                      <span className="break-all">{group.baseURL}</span>
                    </Item>
                  )}
                  <Item label={localize('com_config_providers_azure_field_deployment')}>
                    {group.deploymentName ?? none}
                  </Item>
                  <Item label={localize('com_config_providers_azure_field_version')}>
                    {group.version ?? none}
                  </Item>
                  <Item label={localize('com_config_providers_azure_field_assistants')}>
                    {yesNo(group.assistants)}
                  </Item>
                  {group.additionalHeaders && (
                    <Item label={localize('com_config_providers_azure_field_headers')}>
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {Object.entries(group.additionalHeaders).map(([name, value]) => (
                          <li key={name} className="break-all">
                            <span className="font-mono">{name}</span>: <Credential value={value} />
                          </li>
                        ))}
                      </ul>
                    </Item>
                  )}
                  {group.addParams && (
                    <Item label={localize('com_config_providers_azure_field_addParams')}>
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {Object.entries(group.addParams).map(([name, value]) => (
                          <li key={name} className="break-all">
                            <span className="font-mono">{name}</span>:{' '}
                            {formatConfigValue(value, localize, name)}
                          </li>
                        ))}
                      </ul>
                    </Item>
                  )}
                  {group.dropParams && group.dropParams.length > 0 && (
                    <Item label={localize('com_config_providers_azure_field_dropParams')}>
                      <span className="font-mono break-all">{group.dropParams.join(', ')}</span>
                    </Item>
                  )}
                </dl>
                <section aria-labelledby="azure-drawer-models" className="flex flex-col gap-2">
                  <h3
                    id="azure-drawer-models"
                    className="m-0 text-sm font-semibold text-(--cui-color-text-default)"
                  >
                    {localize('com_config_providers_azure_models_title')}
                  </h3>
                  {group.models.length === 0 ? (
                    <p className="settings-help m-0">
                      {localize('com_config_providers_azure_models_empty')}
                    </p>
                  ) : (
                    <table className="azure-groups-table azure-models-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_name')}
                          </th>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_deployment')}
                          </th>
                          <th scope="col">
                            {localize('com_config_providers_azure_model_col_version')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.models.map((model) => (
                          <tr key={model.name}>
                            <th scope="row" className="font-mono">
                              {model.name}
                            </th>
                            <td className="font-mono">{model.deploymentName ?? inherits}</td>
                            <td>{model.version ?? inherits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
