import yaml from 'js-yaml';
import type * as t from '@/types';
import { SECTION_META, fallbackSectionTitle } from '../configMeta';
import { isConfigValueEqual, maskStoredSecrets } from '@/utils';

function sectionLabel(key: string, localize: t.LocalizeFn): string {
  const meta = SECTION_META[key];
  return meta ? localize(meta.titleKey) : fallbackSectionTitle(key);
}

/**
 * The top-level sections of a previewed config, in the result's order and
 * then librechat.yaml's, each with whether the result differs from
 * librechat.yaml (an admin override changes it).
 */
export function previewSections(
  preview: t.ConfigPreview,
  localize: t.LocalizeFn,
): t.PreviewSection[] {
  const keys = new Set([...Object.keys(preview.resolved), ...Object.keys(preview.yaml)]);
  return Array.from(keys, (key) => ({
    key,
    label: sectionLabel(key, localize),
    changed: !isConfigValueEqual(preview.resolved[key], preview.yaml[key]),
  }));
}

/**
 * A previewed tree as YAML. The server withholds secrets; anything still under
 * a key the panel's secret rule names is masked here too
 * (`maskStoredSecrets`), while `${VAR}` references stay readable.
 */
export function formatPreviewYaml(value: t.ConfigValue): string {
  return yaml
    .dump(maskStoredSecrets(value), {
      lineWidth: 120,
      noRefs: true,
      skipInvalid: true,
    })
    .trimEnd();
}

/** Where part of a document is, as the preview lists it (`endpoints › custom › Ollama › apiKey`). */
export function formatSegments(segments: readonly string[]): string {
  return segments.join(' › ');
}
