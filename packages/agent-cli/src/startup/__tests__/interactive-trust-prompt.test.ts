/**
 * Issue #3268: an interactive start in an untrusted workspace asks whether to trust it, before the
 * project is composed; a run no one is at, or whose access was decided for it, is not asked.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { askToTrustWorkspace, startsNewTuiSession } from '../interactive-trust-prompt.js';
import { resolveInitialCliWorkspaceProjectAccess } from '../workspace-project-composition.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
  vi.unstubAllEnvs();
});

/** An untrusted Git workspace, with the trust store in a temporary HOME. */
function untrustedRepository(): string {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'robota-trust-prompt-')));
  cleanup.push(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, 'home');
  const repo = join(scratch, 'repo');
  mkdirSync(home);
  execFileSync('git', ['init', '--quiet', repo]);
  vi.stubEnv('HOME', home);
  return repo;
}

describe('askToTrustWorkspace', () => {
  it('asks at an interactive start, and a yes starts it Trusted and records the grant', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    const written: string[] = [];
    const confirm = vi.fn(async () => true);

    const result = await askToTrustWorkspace(access, repo, {
      interactive: true,
      accessFixed: false,
      confirm,
      write: (text) => written.push(text),
    });

    expect(access.status).toBe('restricted');
    expect(confirm).toHaveBeenCalledWith('Trust this folder? [y/N] ');
    expect(written.join('')).toContain(`This folder is not trusted: ${repo}`);
    expect(written.join('')).toContain('Project sources');
    expect(result.status).toBe('trusted');
    // Recorded, so the next start is Trusted without asking.
    await expect(resolveInitialCliWorkspaceProjectAccess(repo)).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('starts Restricted on a no, and says how to trust it later', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    const written: string[] = [];

    const result = await askToTrustWorkspace(access, repo, {
      interactive: true,
      accessFixed: false,
      confirm: async () => false,
      write: (text) => written.push(text),
    });

    expect(result).toBe(access);
    expect(written.join('')).toContain(
      'Starting Restricted. Trust it later with: robota trust --yes',
    );
    await expect(resolveInitialCliWorkspaceProjectAccess(repo)).resolves.toMatchObject({
      status: 'restricted',
    });
  });

  it.each([
    ['a run no one is at', { interactive: false, accessFixed: false }],
    [
      'access decided for the run (safe mode, a Restricted /cd, an embedder)',
      { interactive: true, accessFixed: true },
    ],
  ])('does not ask for %s', async (_case, flags) => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    const confirm = vi.fn(async () => true);

    const result = await askToTrustWorkspace(access, repo, {
      ...flags,
      confirm,
      write: () => undefined,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result).toBe(access);
  });

  it('does not ask where a grant cannot help: outside Git, or a store it cannot read', async () => {
    const confirm = vi.fn(async () => true);
    for (const state of ['identity-unavailable', 'store-unavailable'] as const) {
      const access = createRestrictedWorkspaceProjectAccess(state, '/nowhere');
      await askToTrustWorkspace(access, '/nowhere', {
        interactive: true,
        accessFixed: false,
        confirm,
        write: () => undefined,
      });
    }
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('startsNewTuiSession', () => {
  const tui = {
    printMode: false,
    goal: undefined,
    serve: false,
    positional: [] as string[],
    configure: false,
    configureProvider: undefined,
    setCurrent: false,
    continueMode: false,
    resumeId: undefined,
  };

  it('is a new TUI session, with or without an initial prompt', () => {
    expect(startsNewTuiSession(tui)).toBe(true);
    expect(startsNewTuiSession({ ...tui, positional: ['explain the build'] })).toBe(true);
  });

  it.each([
    ['print mode', { printMode: true }],
    ['--goal', { goal: 'ship it' }],
    ['--serve', { serve: true }],
    ['init', { positional: ['init'] }],
    ['mcp serve', { positional: ['mcp', 'serve'] }],
    ['--configure', { configure: true }],
    ['--configure-provider', { configureProvider: 'anthropic' }],
    ['--set-current', { setCurrent: true }],
    // A resumed session must stay in the store it was saved in; a grant would move it out of reach.
    ['--continue', { continueMode: true }],
    ['--resume <id>', { resumeId: 'abc' }],
    ['--resume (picker)', { resumeId: '' }],
  ])('is not one for %s', (_case, change) => {
    expect(startsNewTuiSession({ ...tui, ...change })).toBe(false);
  });
});

describe('askToTrustWorkspace when the grant fails', () => {
  it('says so and starts Restricted rather than failing the start', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    const written: string[] = [];

    const result = await askToTrustWorkspace(access, repo, {
      interactive: true,
      accessFixed: false,
      confirm: async () => true,
      write: (text) => written.push(text),
      grant: async () => {
        throw new Error('store is read-only');
      },
    });

    expect(result).toBe(access);
    expect(written.join('')).toContain(
      'Could not record trust (store is read-only). Starting Restricted.',
    );
  });
});
