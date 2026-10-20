import { describe, it, expect } from 'vitest';
import { validateMcpCrossField } from '../validation';

describe('validateMcpCrossField', () => {
  it('flags an existing sse entry whose transport is changed to stdio without command/args', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.type', 'stdio']]);
    expect(errors.length).toBe(1);
    expect(errors[0].entryKey).toBe('foo');
    expect(errors[0].missingField).toBe('command');
  });

  it('passes when a transport switch is accompanied by the new required fields', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [
      ['mcpServers.foo.type', 'stdio'],
      ['mcpServers.foo.command', 'node'],
      ['mcpServers.foo.args', ['index.js']],
    ]);
    expect(errors).toEqual([]);
  });

  it('treats http as streamable-http and ignores entries with no edits', () => {
    const baseline = {
      foo: { type: 'streamable-http', url: 'https://x.example.com' },
      bar: { type: 'stdio', command: 'node', args: ['x.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.type', 'http']]);
    expect(errors).toEqual([]);
  });

  it('does not flag a deleted entry', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo', undefined]]);
    expect(errors).toEqual([]);
  });

  it('treats a scope-mode leaf reset as revealing the inherited base value', () => {
    /** In scope mode: scopeBaseline has the scope-overridden url; configValues (base) has the inherited url. Resetting mcpServers.foo.url should reveal the base url, so the validator must not flag missing url. */
    const scopeBaseline = {
      foo: { type: 'sse', url: 'https://scope-override.example.com' },
    };
    const baseFallback = {
      foo: { type: 'sse', url: 'https://base.example.com' },
    };
    const errors = validateMcpCrossField(
      scopeBaseline,
      [['mcpServers.foo.url', undefined]],
      baseFallback,
    );
    expect(errors).toEqual([]);
  });

  it('still flags a scope reset when no base inheritance is available', () => {
    const scopeBaseline = {
      foo: { type: 'sse', url: 'https://scope-only.example.com' },
    };
    const baseFallback = {};
    const errors = validateMcpCrossField(
      scopeBaseline,
      [['mcpServers.foo.url', undefined]],
      baseFallback,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].missingField).toBe('url');
  });

  it('treats a base-mode leaf reset on a YAML-defined entry as revealing the YAML value when the YAML map is supplied as resetFallback', () => {
    /** In base mode the admin panel writes to the base config override doc; a DELETE on a field path reveals the underlying YAML value. With the YAML map fed in as resetFallback the validator should see the inherited value and not flag the field as missing. */
    const baseline = {
      kapa: { type: 'stdio', command: 'node-overridden', args: ['index.js'] },
    };
    const yamlFallback = {
      kapa: { type: 'stdio', command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(
      baseline,
      [['mcpServers.kapa.command', undefined]],
      yamlFallback,
    );
    expect(errors).toEqual([]);
  });

  it('accepts an empty array for stdio args (the Zod schema requires presence but allows []) without flagging it as missing', () => {
    const baseline = {
      foo: { type: 'stdio', command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.args', []]]);
    expect(errors).toEqual([]);
  });

  it('flags a stdio-by-inference entry whose command is cleared, falling back to the baseline transport when the merged entry loses its discriminator', () => {
    /** YAML can omit `type` for stdio (the backend Zod schema defaults it). The renderer's transport inference relies on `command` to identify stdio in that case. When the user clears `command`, the merged entry has no discriminator and the inferred transport is empty. Without a baseline fallback the validator skipped the required-field check and let the broken entry save. */
    const baseline = {
      foo: { command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.command', '']]);
    expect(errors.length).toBe(1);
    expect(errors[0].entryKey).toBe('foo');
    expect(errors[0].missingField).toBe('command');
  });
});
