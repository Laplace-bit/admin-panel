import { z } from 'zod';
import yaml from 'js-yaml';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { isConfigRecord, findUnknownImportPaths } from '@/utils';

/** Leaf paths of `raw` the bundled config schema does not describe (AppService aliases resolved). */
export function findUnknownConfigPaths(raw: Record<string, t.ConfigValue>): string[] {
  return findUnknownImportPaths(raw);
}

/** What a non-object value is, in Zod's words ("Expected object, received array"). */
function received(value: t.ConfigValue): string {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}

/**
 * Problems of an imported `mcpServers` block before a target is chosen: it
 * must hold servers by name, each an object. Whether a server is complete
 * depends on the target (a sparse `github: { timeout: 120000 }` overrides
 * the target's own `github`), so the preview validates each one merged onto
 * the chosen target's servers, as the save does.
 */
function mcpShapeErrors(servers: t.ConfigValue): t.ImportValidationError[] {
  if (servers === undefined) return [];
  if (!isConfigRecord(servers)) {
    return [{ path: 'mcpServers', message: `Expected object, received ${received(servers)}` }];
  }
  return Object.entries(servers).flatMap(([name, server]) =>
    isConfigRecord(server)
      ? []
      : [{ path: `mcpServers.${name}`, message: `Expected object, received ${received(server)}` }],
  );
}

/**
 * Parses and validates pasted/uploaded YAML for import. MCP servers are
 * checked for shape only (`mcpShapeErrors`): the preview validates them
 * against the chosen target. Validation runs on a copy with `version`
 * replaced (a snippet need not carry it, and import never writes it, so
 * `version: 1.2` read as a number must not fail), but the result
 * is the raw parsed object: no Zod defaults are injected and keys the bundled
 * schema does not know are kept (and reported in `unknownPaths`). Keys the
 * admin API can't store do not fail the parse: the import plan leaves out
 * only the leaves that carry them, and only when they would be written.
 */
export function parseConfigYaml(yamlContent: string): t.ImportParseResult {
  const failure = (
    error: string,
    extra: Pick<t.ImportParseResult, 'validationErrors' | 'mark'> = {},
  ): t.ImportParseResult => ({
    success: false,
    error,
    appConfig: null,
    unknownPaths: [],
    ...extra,
  });

  let rawConfig: unknown;
  try {
    rawConfig = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
  } catch (parseError) {
    const { mark, reason } = parseError as {
      mark?: { line: number; column: number };
      reason?: string;
    };
    if (!mark) return failure('Invalid YAML syntax. Please check the content for syntax errors.');
    const line = mark.line + 1;
    const column = mark.column + 1;
    return failure(
      `Invalid YAML syntax (line ${line}, column ${column})${reason ? `: ${reason}` : ''}`,
      { mark: { line, column } },
    );
  }

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return failure('YAML did not produce a valid configuration object');
  }

  const appConfig = rawConfig as t.ConfigRecord;
  const { mcpServers, ...rest } = appConfig;
  const result = configSchema.safeParse({ ...rest, version: '1.0.0' });
  const validationErrors = [
    ...(result.success
      ? []
      : result.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
          path: e.path.join('.'),
          message: e.message,
        }))),
    ...mcpShapeErrors(mcpServers),
  ];
  if (validationErrors.length > 0) {
    return failure('Config validation failed', { validationErrors });
  }

  return {
    success: true,
    appConfig,
    unknownPaths: findUnknownConfigPaths(appConfig),
  };
}

export const parseImportedYaml = createServerFn({ method: 'POST' })
  .validator(z.object({ yamlContent: z.string() }))
  .handler(async ({ data }) => parseConfigYaml(data.yamlContent));
