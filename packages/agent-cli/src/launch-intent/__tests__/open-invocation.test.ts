/** FLOW-2006 TC-04 — the pre-parse step: what it handles, what it refuses, what it hands back. */
import { describe, expect, it } from 'vitest';

import { resolveLaunchInvocation, stripOpenInvocation } from '../open-invocation.js';

import type { IResolveLaunchInvocationDeps } from '../open-invocation.js';

function deps(overrides: Partial<IResolveLaunchInvocationDeps> = {}): IResolveLaunchInvocationDeps {
  return {
    listGrants: async () => [],
    inspectTrust: async () => 'trusted',
    realDirectory: (cwd) => cwd,
    readRemoteUrl: async () => undefined,
    isMainWorktree: () => true,
    isInteractive: () => true,
    ...overrides,
  };
}

const argv = (...rest: string[]): string[] => ['/bin/node', '/bin/robota', ...rest];

describe('resolveLaunchInvocation', () => {
  it('is not an open invocation for a plain run, a flag run, or a near-miss positional', async () => {
    for (const args of [argv(), argv('--help'), argv('opener', 'x'), argv('eval', 'x')]) {
      expect((await resolveLaunchInvocation(args, deps())).kind).toBe('not-an-open-invocation');
    }
  });

  it('hands back the resolved cwd and the prompt, and nothing else', async () => {
    const outcome = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo'),
      deps({ realDirectory: () => '/real/repo' }),
    );
    expect(outcome).toEqual({ kind: 'launch', cwd: '/real/repo', initialInput: 'hi' });
  });

  it('refuses a missing link, a second argument, and a non-interactive terminal', async () => {
    const noLink = await resolveLaunchInvocation(argv('open'), deps());
    expect(noLink).toMatchObject({ kind: 'refused', exitCode: 1 });

    const twoArgs = await resolveLaunchInvocation(
      argv(
        'open',
        'robota://open?v=1&prompt=hi&cwd=/repo',
        'robota://open?v=1&prompt=x&cwd=/other',
      ),
      deps(),
    );
    expect(twoArgs).toMatchObject({ kind: 'refused', exitCode: 1 });
    if (twoArgs.kind === 'refused') expect(twoArgs.message).toContain('exactly one link');

    // The user's own flags are not positionals: a link says where to start and what is typed, and
    // nothing else about the invocation. `--name` is how every PTY fixture names its session.
    const withFlag = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo', '--name', 'probe'),
      deps({ realDirectory: () => '/real/repo' }),
    );
    expect(withFlag).toEqual({ kind: 'launch', cwd: '/real/repo', initialInput: 'hi' });

    const flagValue = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo', '--name', 'probe', '--screen-reader'),
      deps({ realDirectory: () => '/real/repo' }),
    );
    expect(flagValue).toEqual({ kind: 'launch', cwd: '/real/repo', initialInput: 'hi' });

    const headless = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo'),
      deps({ isInteractive: () => false }),
    );
    expect(headless).toMatchObject({ kind: 'refused', exitCode: 1 });
    if (headless.kind === 'refused') expect(headless.message).toContain('interactive terminal');
  });

  it('refuses a malformed link and an untrusted target, naming the rule, with no launch', async () => {
    const malformed = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo&provider=anthropic'),
      deps(),
    );
    expect(malformed.kind).toBe('refused');
    if (malformed.kind === 'refused') expect(malformed.message).toContain('provider');

    const untrusted = await resolveLaunchInvocation(
      argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo'),
      deps({ inspectTrust: async () => 'untrusted' }),
    );
    expect(untrusted.kind).toBe('refused');
    if (untrusted.kind === 'refused') expect(untrusted.message).toContain('robota trust --yes');
  });
});

describe('stripOpenInvocation', () => {
  it('removes exactly the two tokens, in place, and leaves anything else alone', () => {
    const args = argv('open', 'robota://open?v=1&prompt=hi&cwd=/repo', '--no-session-persistence');
    stripOpenInvocation(args);
    expect(args).toEqual(['/bin/node', '/bin/robota', '--no-session-persistence']);

    const untouched = argv('--help');
    stripOpenInvocation(untouched);
    expect(untouched).toEqual(['/bin/node', '/bin/robota', '--help']);
  });
});
