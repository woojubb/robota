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

import { askToTrustWorkspace, startsNewTuiSession, trustQuestionFor } from '../interactive-trust-prompt.js';
import { resolveInitialCliWorkspaceProjectAccess } from '../workspace-project-composition.js';
import { runWorkspaceTrustCommand } from '../workspace-trust-command.js';

// #3282 §3: `inspectPreTrustProjectPaths` reports every path as `unavailable` unless run on Linux (see
// its own doc comment), which makes the filtering `trustQuestionFor` does deterministic to assert only
// on Linux without a mock. The mock defaults to the real implementation (call-through) so every other
// test in this file, which never varies path state, is unaffected; only the two tests below that need a
// specific mixed/unavailable-only result install a one-shot override.
const { inspectPreTrustProjectPaths } = vi.hoisted(() => ({ inspectPreTrustProjectPaths: vi.fn() }));
vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  inspectPreTrustProjectPaths.mockImplementation(actual.inspectPreTrustProjectPaths);
  return { ...actual, inspectPreTrustProjectPaths };
});

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

describe('trustQuestionFor — #3282 §3 rows with an unknown state are omitted', () => {
  it('lists only rows whose kind is known, in the same order', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    // Deliberately mixed and out of the candidate list's own order, so a passing test cannot be an
    // accident of "everything happens to line up".
    inspectPreTrustProjectPaths.mockImplementationOnce((_identity: unknown, paths: readonly string[]) =>
      paths.map((_path, index) =>
        index % 3 === 0 ? { kind: 'unavailable' } : { kind: index % 3 === 1 ? 'absent' : 'directory' },
      ),
    );

    const question = trustQuestionFor(access, repo);

    expect(question?.loads.length).toBeGreaterThan(0);
    expect(question?.loads.every((line) => !line.startsWith('  [unavailable]'))).toBe(true);
    expect(question?.loads.some((line) => line.startsWith('  [absent]'))).toBe(true);
    expect(question?.loads.some((line) => line.startsWith('  [directory]'))).toBe(true);
  });

  it('every row unknown leaves no rows — no "[unavailable]" noise', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo);
    inspectPreTrustProjectPaths.mockImplementationOnce((_identity: unknown, paths: readonly string[]) =>
      paths.map(() => ({ kind: 'unavailable' })),
    );

    const question = trustQuestionFor(access, repo);

    expect(question?.loads).toEqual([]);
  });
});

describe('robota trust status --json', () => {
  it('reports what a client needs to ask a person: state, folder, askable, what trust loads', async () => {
    const repo = untrustedRepository();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await runWorkspaceTrustCommand(['status', '--json'], repo)).toBe(0);
      const report = JSON.parse(stdout.mock.calls.map(([text]) => String(text)).join('')) as {
        state: string;
        workspace: string;
        askable: boolean;
        loads: string[];
      };
      expect(report).toMatchObject({ state: 'untrusted', workspace: repo, askable: true });
      // #3282 §3: a row appears only when its state is known. Only Linux's pinned handle-walk can
      // tell a not-yet-created `.robota/settings.json` apart from one it cannot describe safely, so
      // elsewhere every candidate is unknown before trust and `loads` reports none of them — no
      // `[unavailable]` noise, rather than a claim about every path this platform cannot verify.
      if (process.platform === 'linux') {
        expect(report.loads.some((line) => line.includes('.robota/settings.json'))).toBe(true);
      } else {
        expect(report.loads).toEqual([]);
      }

      stdout.mockClear();
      expect(await runWorkspaceTrustCommand(['--yes'], repo)).toBe(0);
      stdout.mockClear();
      await runWorkspaceTrustCommand(['status', '--json'], repo);
      expect(JSON.parse(stdout.mock.calls.map(([text]) => String(text)).join(''))).toMatchObject({
        state: 'trusted',
        askable: false,
        loads: [],
      });
    } finally {
      stdout.mockRestore();
    }
  });
});
