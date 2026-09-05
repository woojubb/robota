/**
 * Issue #2023 — a policy file that exists and cannot be understood must not read as "no policy".
 *
 * Every enforcement site spells its guard `orgPolicy?.<field> && <violation>`, so `null` means "no
 * restrictions". The loader returned `null` for a missing file AND for a corrupt one, which made a
 * truncated or mangled policy behave exactly like having deployed none — silently removing provider
 * allowlisting, blocked commands and the plaintext-key requirement together.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOrgPolicy } from '../org-policy-loader.js';
import { OrgPolicyParseError } from '../org-policy-parse-error.js';

let home = '';

// The loader resolves the policy path from `homedir()`. Mocked at module scope so each case can
// point it at a directory it controls, rather than writing into the real home.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: (): string => home };
});

/** Put a policy file in this case's home, or leave the directory empty. */
function withPolicyFile(contents?: string): void {
  mkdirSync(join(home, '.robota'), { recursive: true });
  if (contents !== undefined) writeFileSync(join(home, '.robota', 'org-policy.json'), contents);
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'org-policy-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe('loadOrgPolicy (issue #2023)', () => {
  it('returns null when no policy is deployed — the common case still does not throw', () => {
    // The `allow-fallback` comment this replaces was right to care about startup. A MISSING file is
    // what it was protecting, and it still returns null.
    expect(loadOrgPolicy()).toBeNull();
  });

  it('throws when a deployed policy file cannot be parsed, instead of reading as no policy', () => {
    withPolicyFile('{"allowedProviders": ["anthropic"');

    expect(() => loadOrgPolicy()).toThrow(OrgPolicyParseError);
  });

  it('names the file and says policy is not applied, so an administrator can act', () => {
    withPolicyFile('not json at all');

    expect(() => loadOrgPolicy()).toThrow(/org-policy\.json/);
    expect(() => loadOrgPolicy()).toThrow(/Policy is NOT applied/);
  });

  it('refuses valid JSON of the wrong shape, which would otherwise MIS-enforce', () => {
    // `allowedProviders` as a string is truthy, so the guard fires and then matches on substring:
    // a profile named `ant` passes an allowlist naming only `anthropic`. A policy that mis-enforces
    // is worse than one that does not load, because it looks like it is working.
    withPolicyFile(JSON.stringify({ allowedProviders: 'anthropic' }));

    expect(() => loadOrgPolicy()).toThrow(/must be an array of strings/);
  });

  it('refuses an array, which `typeof === object` alone would admit', () => {
    withPolicyFile('[]');

    expect(() => loadOrgPolicy()).toThrow(/expected a JSON object, found an array/);
  });

  it('accepts a well-formed policy unchanged', () => {
    // The companion the refusals need: without it, a loader that threw on everything would pass.
    withPolicyFile(JSON.stringify({ allowedProviders: ['anthropic'], requireApiKeyFromEnv: true }));

    expect(loadOrgPolicy()).toEqual({
      allowedProviders: ['anthropic'],
      requireApiKeyFromEnv: true,
    });
  });
});
