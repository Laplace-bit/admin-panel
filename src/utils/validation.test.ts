import { describe, it, expect } from 'vitest';
import { classifyReportedIssue, describeIssueCode, paramlessIssueCode } from './validation';
import { describeApiError, errorText } from './errors';

function wording(code: string, params?: Parameters<typeof classifyReportedIssue>[1]): string {
  const issue = classifyReportedIssue(code, params);
  return describeIssueCode(issue.code, issue.params, 'is not a valid value');
}

describe('classifyReportedIssue', () => {
  it('words a code without its parameters when the server reports none', () => {
    expect(classifyReportedIssue('too_small', undefined)).toEqual({ code: 'too_small_value' });
    expect(classifyReportedIssue('custom', undefined)).toEqual({ code: 'custom' });
    expect(paramlessIssueCode('dotted_key')).toBe('dotted_key');
  });

  it('words bounds by what they bound and whether they are inclusive', () => {
    expect(
      wording('too_small', { minimum: 1, inclusive: true, exact: false, type: 'number' }),
    ).toBe('must be at least 1');
    expect(
      wording('too_big', { maximum: 100, inclusive: false, exact: false, type: 'number' }),
    ).toBe('must be less than 100');
    expect(wording('too_small', { minimum: 3, inclusive: true, type: 'string' })).toBe(
      'must be at least 3 characters',
    );
    expect(wording('too_big', { maximum: 5, inclusive: true, type: 'array' })).toBe(
      'must have at most 5 items',
    );
    expect(classifyReportedIssue('too_small', { inclusive: true, type: 'date' })).toEqual({
      code: 'too_small_value',
    });
  });

  it('words expected types, literals and options', () => {
    expect(wording('invalid_type', { expected: 'integer', received: 'number' })).toBe(
      'must be a whole number',
    );
    expect(wording('invalid_type', { expected: 'string', received: 'undefined' })).toBe(
      'is required',
    );
    expect(wording('invalid_literal', { expected: 'stdio' })).toBe('must be "stdio"');
    expect(wording('invalid_enum_value', { options: ['low', 'high'] })).toBe(
      'must be one of "low", "high"',
    );
    expect(wording('invalid_union_discriminator', { options: ['sse', 'http'] })).toBe(
      'must be one of "sse", "http"',
    );
    expect(wording('invalid_enum_value', { options: [] })).toBe('is not one of the allowed values');
  });

  it('words string checks, multiples and a refinement by its reason', () => {
    expect(wording('invalid_string', { validation: 'url' })).toBe('must be a valid URL');
    expect(wording('invalid_string', { validation: 'regex' })).toBe('is not a valid value');
    expect(wording('not_multiple_of', { multipleOf: 5 })).toBe('must be a multiple of 5');
    expect(wording('custom', { reason: 'missing_port' })).toBe(
      'must include a port, for example localhost:11434',
    );
    expect(wording('custom', { reason: 'public_ip' })).toBe(
      'is a public IP address: enter a private address, or a hostname that resolves to one',
    );
    expect(classifyReportedIssue('custom', { reason: 'some_new_rule' })).toEqual({
      code: 'custom',
    });
  });
});

describe('describeApiError', () => {
  it("words the admin API's stable codes, and leaves others to the server's text", () => {
    expect(describeApiError({ code: 'PRINCIPAL_NOT_FOUND' })).toMatch(/doesn't exist/);
    expect(describeApiError({ code: 'FORBIDDEN_SECTION', section: 'memory' })).toBe(
      "You don't have permission to change the memory settings.",
    );
    expect(describeApiError({ code: 'CONFIG_VERSION_CONFLICT' })).toMatch(/Reload the page/);
    expect(describeApiError({ code: 'AUTH_REQUIRED' })).toMatch(/session expired/);
    expect(describeApiError({ code: 'SOME_FUTURE_CODE', error: 'Text' })).toBeNull();
    expect(describeApiError({ error: 'Text' })).toBeNull();
  });

  it('keeps an error text as it is', () => {
    const localize = (key: string) => key;
    expect(errorText(new Error('There is no role named "X"'), 'fallback', localize)).toBe(
      'There is no role named "X"',
    );
  });
});
