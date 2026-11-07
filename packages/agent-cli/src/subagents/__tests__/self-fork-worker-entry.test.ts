import { afterEach, describe, expect, it } from 'vitest';

import { resolveSelfForkWorkerEntry } from '../self-fork-worker-entry.js';

/**
 * DIST-006. This function decides the arguments every subagent spawn uses, and it is the successor
 * to a seam that was wrong twice. The built-binary bintest cannot cover it: that test hardcodes
 * `[bundle, flag]` and never calls this resolver, so breaking it — returning `args: []`
 * unconditionally, say — leaves the bintest green while every shipped subagent spawns a bare `node`
 * REPL and waits out the handshake deadline.
 *
 * Each case pins one branch decision, including the Windows one, which is UNVERIFIED against a real
 * Windows binary (none available). Recording it here at least makes the intended contract
 * mechanical, so a change to it is deliberate rather than accidental.
 */
// Snapshot and restore the WHOLE array, not index 1: the no-entry case splices, which shifts every
// later element down, so an index-wise restore would silently drop one if the runner ever passes a
// third argv element.
const originalArgv = [...process.argv];
const originalExecArgv = [...process.execArgv];

function replaceAll(target: string[], next: readonly string[]): void {
  target.length = 0;
  target.push(...next);
}

function withEntry(entry: string | undefined, execArgv: string[] = []): void {
  replaceAll(
    process.argv,
    entry === undefined ? [originalArgv[0] as string] : [originalArgv[0] as string, entry],
  );
  replaceAll(process.execArgv, execArgv);
}

afterEach(() => {
  replaceAll(process.argv, originalArgv);
  replaceAll(process.execArgv, originalExecArgv);
});

/**
 * #3679: a copy started under a Node that accepts it disables the SIGUSR1 inspector from its first
 * instruction; on an older Node there is nothing to add.
 */
const INSPECTOR_SIGNAL_OFF = process.allowedNodeEnvironmentFlags.has('--disable-sigusr1')
  ? ['--disable-sigusr1']
  : [];

describe('resolveSelfForkWorkerEntry', () => {
  it('names the entry file for a bundled Node artifact', () => {
    withEntry('/opt/test-product/dist/node/bin.js');

    expect(resolveSelfForkWorkerEntry()).toEqual({
      execPath: process.execPath,
      args: ['/opt/test-product/dist/node/bin.js'],
      ...(INSPECTOR_SIGNAL_OFF.length > 0 ? { execArgv: INSPECTOR_SIGNAL_OFF } : {}),
    });
  });

  it('names NOTHING for a Bun single-file binary, whose entry is embedded', () => {
    // `process.execPath` is the binary; re-executing it re-enters the embedded entry. Passing the
    // embedded path to a new process would be meaningless — only the running binary can read it.
    withEntry('/$bunfs/root/bin.js');

    expect(resolveSelfForkWorkerEntry()).toEqual({ execPath: process.execPath, args: [] });
  });

  it('names nothing for the Windows embedded-filesystem prefix too', () => {
    withEntry('B:\\~BUN\\root\\bin.js');

    expect(resolveSelfForkWorkerEntry()).toEqual({ execPath: process.execPath, args: [] });
  });

  it('names nothing when there is no entry argument at all', () => {
    withEntry(undefined);

    expect(resolveSelfForkWorkerEntry()).toEqual({ execPath: process.execPath, args: [] });
  });

  it('adds a TypeScript loader for a source entry that has none', () => {
    withEntry('/repo/packages/agent-cli/src/bin.ts');

    expect(resolveSelfForkWorkerEntry()).toEqual({
      execPath: process.execPath,
      args: ['/repo/packages/agent-cli/src/bin.ts'],
      execArgv: [...INSPECTOR_SIGNAL_OFF, '--import', 'tsx'],
    });
  });

  it('preserves an existing TypeScript loader rather than adding a second one', () => {
    // Under `tsx entry.ts` the parent already carries absolute loader flags; forwarding them keeps
    // conditions like `--conditions=product-source` intact.
    const loaded = ['--import', 'file:///abs/tsx/dist/loader.mjs', '--conditions=product-source'];
    withEntry('/repo/packages/agent-cli/src/bin.ts', loaded);

    expect(resolveSelfForkWorkerEntry()).toEqual({
      execPath: process.execPath,
      args: ['/repo/packages/agent-cli/src/bin.ts'],
      execArgv: [...INSPECTOR_SIGNAL_OFF, ...loaded],
    });
  });

  it('does not add a loader for a compiled entry', () => {
    withEntry('/opt/test-product/dist/node/bin.js', ['--enable-source-maps']);

    expect(resolveSelfForkWorkerEntry().execArgv ?? []).toEqual(INSPECTOR_SIGNAL_OFF);
  });

  it.skipIf(INSPECTOR_SIGNAL_OFF.length === 0)(
    'disables the inspector signal once when the running process already carries the flag',
    () => {
      // A copy started by a copy: the forwarded loader flags already hold it.
      const loaded = ['--disable-sigusr1', '--import', 'file:///abs/tsx/dist/loader.mjs'];
      withEntry('/repo/packages/agent-cli/src/bin.ts', loaded);

      expect(resolveSelfForkWorkerEntry().execArgv).toEqual(loaded);
    },
  );
});
