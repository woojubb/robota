/** FLOW-2006 TC-03 — resolution: trusted-only targets, worktree grouping, and every refusal. */
import { describe, expect, it } from 'vitest';

import { remoteSlug, resolveLaunchTarget } from '../resolve-launch-target.js';

import type { IResolveLaunchTargetDeps, TLaunchTargetTrust } from '../resolve-launch-target.js';
import type { ILaunchIntent } from '../launch-intent.js';
import type { IWorkspaceTrustGrant } from '@robota-sdk/agent-framework';

function intent(partial: Partial<ILaunchIntent>): ILaunchIntent {
  return {
    version: '1',
    prompt: 'hi',
    cwd: undefined,
    repo: undefined,
    repoSuperseded: false,
    ...partial,
  };
}

function grant(partial: Partial<IWorkspaceTrustGrant>): IWorkspaceTrustGrant {
  return {
    repositoryKey: 'repo-a',
    worktreeRoot: '/clones/name',
    state: 'trusted',
    generation: 1,
    ...partial,
  };
}

function deps(overrides: Partial<IResolveLaunchTargetDeps> = {}): IResolveLaunchTargetDeps {
  return {
    listGrants: async () => [],
    inspectTrust: async (): Promise<TLaunchTargetTrust> => 'trusted',
    realDirectory: (cwd) => cwd,
    readRemoteUrl: async () => 'git@github.com:owner/name.git',
    isMainWorktree: () => true,
    ...overrides,
  };
}

describe('remoteSlug', () => {
  it('reduces the SSH, HTTPS and .git-less forms to owner/name', () => {
    for (const url of [
      'git@github.com:owner/name.git',
      'git@github.com:owner/name',
      'https://github.com/owner/name.git',
      'https://github.com/owner/name',
      'ssh://git@github.com/owner/name.git',
    ]) {
      expect(remoteSlug(url)).toBe('owner/name');
    }
    expect(remoteSlug('not a remote')).toBeUndefined();
  });
});

describe('cwd resolution', () => {
  it('resolves an existing, trusted directory to its real path', async () => {
    const result = await resolveLaunchTarget(
      intent({ cwd: '/link/to/repo' }),
      deps({ realDirectory: () => '/real/repo' }),
    );
    expect(result).toEqual({ ok: true, cwd: '/real/repo' });
  });

  it('refuses a directory that does not exist or is a file', async () => {
    const result = await resolveLaunchTarget(
      intent({ cwd: '/missing' }),
      deps({ realDirectory: () => undefined }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('/missing');
  });

  it('refuses every non-trusted state by name, naming the grant command', async () => {
    for (const state of ['untrusted', 'revoked', 'stale/replaced', 'unknown'] as const) {
      const result = await resolveLaunchTarget(
        intent({ cwd: '/repo' }),
        deps({ inspectTrust: async () => state }),
      );
      expect(result.ok, state).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(state);
        expect(result.reason).toContain('robota trust --yes');
      }
    }
  });

  it('refuses when the trust state cannot be read — could not check is not trusted', async () => {
    const result = await resolveLaunchTarget(
      intent({ cwd: '/repo' }),
      deps({
        inspectTrust: async () => {
          throw new Error('store is corrupt');
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('corrupt');
  });
});

describe('repo resolution', () => {
  it('resolves the single trusted repository whose origin matches the slug', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({ listGrants: async () => [grant({ worktreeRoot: '/clones/name' })] }),
    );
    expect(result).toEqual({ ok: true, cwd: '/clones/name' });
  });

  it('treats several worktrees of ONE repository as one answer: the main worktree', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({
        listGrants: async () => [
          grant({ worktreeRoot: '/clones/name/.worktrees/a' }),
          grant({ worktreeRoot: '/clones/name' }),
        ],
        isMainWorktree: (root) => root === '/clones/name',
      }),
    );
    expect(result).toEqual({ ok: true, cwd: '/clones/name' });
  });

  it('refuses when two DISTINCT repositories match, listing the candidates', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({
        listGrants: async () => [
          grant({ repositoryKey: 'repo-a', worktreeRoot: '/clones/one' }),
          grant({ repositoryKey: 'repo-b', worktreeRoot: '/clones/two' }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('/clones/one');
      expect(result.reason).toContain('/clones/two');
    }
  });

  it('refuses when only linked worktrees are trusted, rather than picking one', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({
        listGrants: async () => [grant({ worktreeRoot: '/clones/name/.worktrees/a' })],
        isMainWorktree: () => false,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('main worktree');
  });

  it('skips a clone with no origin rather than failing the whole resolution', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({
        listGrants: async () => [
          grant({ repositoryKey: 'no-origin', worktreeRoot: '/clones/bare' }),
          grant({ worktreeRoot: '/clones/name' }),
        ],
        readRemoteUrl: async (root) =>
          root === '/clones/bare' ? undefined : 'https://github.com/owner/name',
      }),
    );
    expect(result).toEqual({ ok: true, cwd: '/clones/name' });
  });

  it('never considers a grant that is not trusted', async () => {
    const result = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({ listGrants: async () => [grant({ state: 'revoked' })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no trusted local clone');
  });

  it('refuses when the store cannot enumerate, and when reading it throws', async () => {
    const unlistable = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({ listGrants: async () => undefined }),
    );
    expect(unlistable.ok).toBe(false);
    if (!unlistable.ok) expect(unlistable.reason).toContain('cwd=');

    const throwing = await resolveLaunchTarget(
      intent({ repo: 'owner/name' }),
      deps({
        listGrants: async () => {
          throw new Error('unreadable');
        },
      }),
    );
    expect(throwing.ok).toBe(false);
    if (!throwing.ok) expect(throwing.reason).toContain('unreadable');
  });
});

/**
 * The resolver names values the PARSER never screened — a path out of the trust store, a candidate
 * list, the text of a git or store error — in messages a terminal prints. A `ESC[2J ESC[H` in any
 * of them would clear the screen and repaint it over the refusal, so none may be replayed raw.
 */
describe('refusals never replay a control character into the terminal', () => {
  /* eslint-disable no-control-regex -- asserting the control class IS the point */
  const FORBIDDEN_IN_OUTPUT =
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
  /* eslint-enable no-control-regex */
  const esc = String.fromCharCode(27);
  const payload = `${esc}[2J${esc}[HTrusted`;

  async function reasonFor(
    target: Partial<ILaunchIntent>,
    overrides: Partial<IResolveLaunchTargetDeps>,
  ): Promise<string> {
    const outcome = await resolveLaunchTarget(intent(target), deps(overrides));
    expect(outcome.ok).toBe(false);
    return outcome.ok ? '' : outcome.reason;
  }

  it('escapes the path, the candidates and the error text it names', async () => {
    const reasons = [
      // A cwd that does not resolve — the path is echoed back.
      await reasonFor({ cwd: `/tmp/${payload}` }, { realDirectory: () => undefined }),
      // An untrusted target — the path again, this time with the remedy.
      await reasonFor(
        { cwd: `/tmp/${payload}` },
        { realDirectory: (cwd) => cwd, inspectTrust: async () => 'untrusted' },
      ),
      // The trust check itself throws, and the error's own text carries the payload.
      await reasonFor(
        { cwd: '/tmp/ok' },
        {
          inspectTrust: async () => {
            throw new Error(payload);
          },
        },
      ),
      // The grant store throws.
      await reasonFor(
        { repo: 'owner/name' },
        {
          listGrants: async () => {
            throw new Error(payload);
          },
        },
      ),
      // Two distinct repositories match, and a candidate ROOT carries the payload.
      await reasonFor(
        { repo: 'owner/name' },
        {
          listGrants: async () => [
            grant({ repositoryKey: 'a', worktreeRoot: `/clones/${payload}` }),
            grant({ repositoryKey: 'b', worktreeRoot: '/clones/other' }),
          ],
        },
      ),
    ];
    for (const reason of reasons) {
      expect(reason).not.toBe('');
      expect(reason).not.toMatch(FORBIDDEN_IN_OUTPUT);
      // The value is still NAMED — escaping must not degrade into saying nothing.
      expect(reason).toContain('Trusted');
    }
  });
});
