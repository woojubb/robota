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
const originalArgv1 = process.argv[1];
const originalExecArgv = [...process.execArgv];

function withEntry(entry: string | undefined, execArgv: string[] = []): void {
  if (entry === undefined) {
    process.argv.splice(1, 1);
  } else {
    process.argv[1] = entry;
  }
  process.execArgv.length = 0;
  process.execArgv.push(...execArgv);
}

afterEach(() => {
  process.argv[1] = originalArgv1 as string;
  process.execArgv.length = 0;
  process.execArgv.push(...originalExecArgv);
});

describe('resolveSelfForkWorkerEntry', () => {
  it('names the entry file for a bundled Node artifact', () => {
    withEntry('/opt/robota/dist/node/bin.js');

    expect(resolveSelfForkWorkerEntry()).toEqual({
      execPath: process.execPath,
      args: ['/opt/robota/dist/node/bin.js'],
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
      execArgv: ['--import', 'tsx'],
    });
  });

  it('preserves an existing TypeScript loader rather than adding a second one', () => {
    // Under `tsx entry.ts` the parent already carries absolute loader flags; forwarding them keeps
    // conditions like `--conditions=source` intact.
    const loaded = ['--import', 'file:///abs/tsx/dist/loader.mjs', '--conditions=source'];
    withEntry('/repo/packages/agent-cli/src/bin.ts', loaded);

    expect(resolveSelfForkWorkerEntry()).toEqual({
      execPath: process.execPath,
      args: ['/repo/packages/agent-cli/src/bin.ts'],
      execArgv: loaded,
    });
  });

  it('does not add a loader for a compiled entry', () => {
    withEntry('/opt/robota/dist/node/bin.js', ['--enable-source-maps']);

    expect(resolveSelfForkWorkerEntry().execArgv).toBeUndefined();
  });
});
