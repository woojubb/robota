/**
 * CLI-083 (issue #2287) — the org policy is actually LOADED, not merely forwardable.
 *
 * The projection tests assert that each shell carries an `orgPolicy` it is given. They are all green
 * when nobody gives one — which was the state of this repository for three months: `48ebec353` added
 * `const orgPolicy = loadOrgPolicy()` and `92596bc6f` removed it two days later, and four implemented
 * enforcement sites went unreachable without a single test turning red.
 *
 * Measured while writing this: replacing the restored `loadOrgPolicy()` call with `null` left all 432
 * agent-cli tests green. **A chain being present is not the chain being fed**, and only a case that
 * puts a real `org-policy.json` on disk and drives the real entry point can tell those apart.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { buildCommandSetup, buildCommandSetupOrExit } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;
const homes: string[] = [];

const SETTINGS_JSON = JSON.stringify({
  currentProvider: 'anthropic',
  providers: {
    anthropic: { type: 'anthropic', model: 'm' },
    openai: { type: 'openai', model: 'm' },
  },
});

/** A HOME with a real `~/.robota/org-policy.json`, which is the only thing `loadOrgPolicy` reads. */
function homeWithPolicy(policy: unknown): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cli-083-home-')));
  homes.push(home);
  mkdirSync(join(home, '.robota'), { recursive: true });
  writeFileSync(join(home, '.robota', 'org-policy.json'), JSON.stringify(policy), 'utf8');
  writeFileSync(join(home, '.robota', 'settings.json'), SETTINGS_JSON, 'utf8');
  return home;
}

/** The same HOME, with a policy file written verbatim so a case can make it unreadable. */
function homeWithRawPolicy(raw: string): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'issue-2023-home-')));
  homes.push(home);
  mkdirSync(join(home, '.robota'), { recursive: true });
  writeFileSync(join(home, '.robota', 'org-policy.json'), raw, 'utf8');
  writeFileSync(join(home, '.robota', 'settings.json'), SETTINGS_JSON, 'utf8');
  return home;
}

function providerExecutor(cwd: string): SystemCommandExecutor {
  const setup = buildCommandSetup(cwd, MINIMAL_ARGS, {}, '0.0.0-test');
  const provider = setup.baseCommandModules.find((m) => m.name === 'agent-command-provider');
  if (provider === undefined) throw new Error('the provider command module was not built');
  return new SystemCommandExecutor([...(provider.systemCommands ?? [])]);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('CLI-083: the loaded policy is SURFACED, not only consumed in place', () => {
  it('returns the policy from `buildCommandSetup`, so the session path can be fed', () => {
    // Found in review: the first version of this change loaded the policy and handed it only to
    // `createDefaultCommandModules`. That reaches the provider checks and leaves the SESSION-level
    // `blockedCommands` enforcement dead — three of the four sites — while looking wired.
    //
    // This case is the source half of that hop. The `cli.ts` half (forwarding it into
    // `runServeMode` and `renderApp`) is NOT covered by any test: `cli.ts` has no seam that a test
    // can drive, and extracting one is not this item's change. That gap is named here rather than
    // papered over, because it is exactly the gap that let the defect through review-stage once.
    const home = homeWithPolicy({ blockedCommands: ['clear'], adminContact: 'ops@x' });
    vi.stubEnv('HOME', home);

    const setup = buildCommandSetup(home, MINIMAL_ARGS, {}, '0.0.0-test');

    expect(setup.orgPolicy).toEqual({ blockedCommands: ['clear'], adminContact: 'ops@x' });
  });

  it('returns undefined when there is no policy file, so absence stays distinguishable', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'cli-083-surface-none-')));
    homes.push(home);
    mkdirSync(join(home, '.robota'), { recursive: true });
    writeFileSync(join(home, '.robota', 'settings.json'), SETTINGS_JSON, 'utf8');
    vi.stubEnv('HOME', home);

    expect(buildCommandSetup(home, MINIMAL_ARGS, {}, '0.0.0-test').orgPolicy).toBeUndefined();
  });
});

describe('CLI-083: a policy file on disk reaches the enforcement', () => {
  it('blocks a provider switch forbidden only by ~/.robota/org-policy.json', async () => {
    const home = homeWithPolicy({ allowedProviders: ['anthropic'], adminContact: 'ops@x' });
    vi.stubEnv('HOME', home);

    const result = await providerExecutor(home).execute(
      'provider',
      createTestCommandHost(),
      'switch openai',
    );

    // Nothing in this test hands a policy to anything. The only path from that file to this refusal
    // is the `loadOrgPolicy()` call, so removing it turns this red — which the weaker version of
    // this case (`not.toThrow`, `toBeDefined`) did not: it survived that mutant and proved nothing.
    expect(result?.success).toBe(false);
    expect(result?.message).toContain('"openai" is not allowed');
    expect(result?.message).toContain('anthropic');
  });

  it('allows the same switch when no policy file exists — the read is what differs', async () => {
    // The control. Without it, a build that refused every switch for an unrelated reason would
    // satisfy the case above.
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'cli-083-nopolicy-')));
    homes.push(home);
    mkdirSync(join(home, '.robota'), { recursive: true });
    writeFileSync(join(home, '.robota', 'settings.json'), SETTINGS_JSON, 'utf8');
    vi.stubEnv('HOME', home);

    const result = await providerExecutor(home).execute(
      'provider',
      createTestCommandHost(),
      'switch openai',
    );

    expect(result?.message ?? '').not.toContain('is not allowed');
  });
});

describe('issue #2023: an unreadable policy is presented, not thrown at the user', () => {
  it('writes the message and exits 1 instead of escaping as an unhandled exception', () => {
    // Review finding on PR #2324: `loadOrgPolicy` throws now, and its only production caller did not
    // catch it — so a corrupted `~/.robota/org-policy.json` crashed the CLI with a stack trace. That
    // is the outcome the comment this change replaced was protecting against, and a stack trace does
    // not tell an administrator which file to fix.
    const home = homeWithRawPolicy('{"allowedProviders": ["anthropic"');
    vi.stubEnv('HOME', home);
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    expect(() => buildCommandSetupOrExit(home, MINIMAL_ARGS, {}, '0.0.0-test')).toThrow('exited');

    expect(exit).toHaveBeenCalledWith(1);
    expect(written.join('')).toContain('org-policy.json');
    expect(written.join('')).toContain('Policy is NOT applied');
  });

  it("lets an unrelated startup failure through, rather than presenting someone else's message", () => {
    // The companion the case above needs. A broad catch would turn every unrelated startup defect
    // into a clean exit carrying the org-policy message — a worse failure than the one being fixed,
    // and one that would still pass the assertion above.
    //
    // The first version of this case used a nonexistent cwd, which turns out not to fail at all, so
    // it asserted nothing: a mutant removing the `instanceof` narrowing survived it. Measured, what
    // `buildCommandSetup` actually throws for an unrelated reason is `SettingsParseError` — a
    // corrupt `settings.json` beside a perfectly good policy. That mutant now dies.
    const home = homeWithRawPolicy(JSON.stringify({ allowedProviders: ['anthropic'] }));
    writeFileSync(join(home, '.robota', 'settings.json'), '{ not json', 'utf8');
    vi.stubEnv('HOME', home);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    expect(() => buildCommandSetupOrExit(home, MINIMAL_ARGS, {}, '0.0.0-test')).toThrow(
      /invalid JSON/,
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
