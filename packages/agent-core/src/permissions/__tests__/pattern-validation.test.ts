/**
 * Issue #2428 — a malformed permission pattern is named where it is written, with the reason,
 * instead of being discovered one unevaluable prompt at a time at the gate.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { findInvalidPermissionPatterns, validatePermissionPattern } from '../pattern-validation.js';
import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '../permission-gate.js';

afterEach(() => clearRegisteredToolProfiles());

describe('validatePermissionPattern (issue #2428)', () => {
  it('accepts a bare tool, a wildcard, and a pattern for a tool nobody has declared yet', () => {
    expect(validatePermissionPattern('Bash')).toBeUndefined();
    expect(validatePermissionPattern('Bash(*)')).toBeUndefined();
    expect(validatePermissionPattern('LaterPackTool(anything)')).toBeUndefined();
  });

  it('refuses a URL pattern the URL grammar rejects, naming the reason', () => {
    registerToolPermissionProfile('WebFetch', {
      argument: { key: 'url', kind: 'url' },
      riskClass: 'inspect',
    });
    expect(validatePermissionPattern('WebFetch(https://*.example.com/**)')).toBeUndefined();
    expect(validatePermissionPattern('WebFetch(https://user@host/x)')).toMatch(
      /URL pattern grammar/,
    );
    expect(validatePermissionPattern('WebFetch(example.com)')).toMatch(/URL pattern grammar/);
  });

  it('accepts Claude domain rules in allow, deny and ask after WebFetch parameters arrive', () => {
    registerToolPermissionProfile('WebFetch', {
      argument: { key: 'url', kind: 'url' },
      riskClass: 'inspect',
      parameters: ['url', 'prompt'],
    });
    for (const domain of [
      'github.com',
      'docs.anthropic.com',
      'www.npmjs.com',
      'raw.githubusercontent.com',
      'hono.dev',
      'vercel.com',
      'EXAMPLE.COM.',
      '*.example.com',
      'example.*',
      'a.*.example.com',
      '*',
    ]) {
      for (const direction of ['allow', 'deny'] as const) {
        expect(
          validatePermissionPattern(`WebFetch(domain:${domain})`, direction),
          domain,
        ).toBeUndefined();
      }
    }
  });

  it.each([
    '',
    'https://example.com',
    'example.com/path',
    'example.com:443',
    'user@example.com',
    'example.com?query',
    'example.com#fragment',
    'example\\com',
    'exa mple.com',
    '.example.com',
    'example..com',
    '**.example.com',
    'api-**.example.com',
  ])('refuses malformed domain rules at startup: %s', (domain) => {
    registerToolPermissionProfile('WebFetch', {
      argument: { key: 'url', kind: 'url' },
      riskClass: 'inspect',
      parameters: ['url', 'prompt'],
    });
    for (const direction of ['allow', 'deny'] as const) {
      expect(validatePermissionPattern(`WebFetch(domain:${domain})`, direction)).toMatch(/grammar/);
    }
  });

  it('refuses an argument-scoped pattern for a declared tool with no argument key', () => {
    registerToolPermissionProfile('AskUserQuestion', { riskClass: 'inspect' });
    expect(validatePermissionPattern('AskUserQuestion(anything)')).toMatch(/no argument key/);
    expect(validatePermissionPattern('AskUserQuestion')).toBeUndefined();
  });

  it('refuses syntactic junk', () => {
    expect(validatePermissionPattern('')).toMatch(/empty/);
    expect(validatePermissionPattern('Bash(git *')).toMatch(/without closing/);
    expect(validatePermissionPattern('(x)')).toMatch(/names no tool/);
    expect(validatePermissionPattern('Bash()')).toMatch(/empty argument pattern/);
  });

  it('findInvalidPermissionPatterns lists each bad pattern with its reason', () => {
    registerToolPermissionProfile('WebFetch', {
      argument: { key: 'url', kind: 'url' },
      riskClass: 'inspect',
    });
    const problems = findInvalidPermissionPatterns(['Bash', 'WebFetch(nope)', 'Read(']);
    expect(problems.map((p) => p.pattern)).toEqual(['WebFetch(nope)', 'Read(']);
    expect(problems[0].reason).toMatch(/URL pattern grammar/);
  });
});
