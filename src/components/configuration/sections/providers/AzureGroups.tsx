import { useMemo, useRef, useState } from 'react';
import type * as t from '@/types';
import { AzureGroupDrawer } from './AzureGroupDrawer';
import { toFieldId } from '../../renderer';
import { toAzureGroups } from './azure';
import { useLocalize } from '@/hooks';

/**
 * Azure OpenAI groups as a read-only table (AP-1 phase 1, D13): Group |
 * Instance or base URL | API version | Models | Serverless | Assistants,
 * each with a details drawer (credentials masked). LibreChat applies Azure
 * groups only from librechat.yaml, so nothing here is editable. Each row is a
 * search target: a found group lands on its row, with its Details button focused.
 */
export function AzureGroupsTable({ path, value, field }: t.AzureGroupsTableProps) {
  const localize = useLocalize();
  const rows = useMemo(() => toAzureGroups(value), [value]);
  const [selected, setSelected] = useState<t.AzureGroupRow | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const yesNo = (on: boolean) =>
    localize(on ? 'com_config_providers_azure_yes' : 'com_config_providers_azure_no');

  if (rows.length === 0) {
    return <p className="settings-help m-0 py-2">{localize('com_config_providers_azure_empty')}</p>;
  }

  return (
    <div id={path.replace(/\./g, '-')} className="azure-groups">
      <table className="azure-groups-table">
        <thead>
          <tr>
            <th scope="col">{localize('com_config_providers_azure_col_group')}</th>
            <th scope="col" className="azure-col-wide">
              {localize('com_config_providers_azure_col_target')}
            </th>
            <th scope="col" className="azure-col-optional">
              {localize('com_config_providers_azure_col_version')}
            </th>
            <th scope="col" className="azure-col-number">
              {localize('com_config_providers_azure_col_models')}
            </th>
            <th scope="col" className="azure-col-optional">
              {localize('com_config_providers_azure_col_serverless')}
            </th>
            <th scope="col" className="azure-col-optional">
              {localize('com_config_providers_azure_col_assistants')}
            </th>
            <th scope="col">
              <span className="sr-only">{localize('com_config_providers_azure_details')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.group} id={`section-${path.replace(/\./g, '-')}-${index}`}>
              <th
                scope="row"
                id={toFieldId(`${path}.${row.index}.group`)}
                className="azure-group-name"
              >
                {row.group}
              </th>
              <td className="azure-col-wide">
                <span className="azure-target" title={row.baseURL ?? row.instanceName}>
                  {row.baseURL ?? row.instanceName ?? '—'}
                </span>
              </td>
              <td className="azure-col-optional azure-col-version">{row.version ?? '—'}</td>
              <td className="azure-col-number">{row.models.length}</td>
              <td className="azure-col-optional">{yesNo(row.serverless)}</td>
              <td className="azure-col-optional">{yesNo(row.assistants)}</td>
              <td className="azure-col-action">
                <button
                  type="button"
                  className="azure-details-btn"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setSelected(row);
                  }}
                  aria-label={localize('com_config_providers_azure_details_aria', {
                    group: row.group,
                  })}
                  aria-haspopup="dialog"
                >
                  {localize('com_config_providers_azure_details')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AzureGroupDrawer
        group={selected}
        path={path}
        field={field}
        onClose={() => setSelected(null)}
        returnFocus={opener}
      />
    </div>
  );
}
