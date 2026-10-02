import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * Issue #3282 §3: `the product --serve --open` asks the same trust question the TUI does, but with the
 * `pnpm gui:dev` sidecar wrapper's three-way answer (trust / start Restricted / quit) instead of the
 * TUI's plain yes-means-trust-no-means-Restricted, since a headless start also needs a way to not start
 * at all.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  askServeOpenTrustQuestion,
  canAskServeOpenTrustQuestion,
} from '../headless-serve-trust-prompt.js';
import { resolveInitialCliWorkspaceProjectAccess } from '../workspace-project-composition.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

/** `isTTY` is a plain own property (not a getter) on Node's stdio streams — set and restore it directly. */
function stubTty(stdin: boolean, stdout: boolean): () => void {
  const previousStdin = process.stdin.isTTY;
  const previousStdout = process.stdout.isTTY;
  process.stdin.isTTY = stdin;
  process.stdout.isTTY = stdout;
  return () => {
    process.stdin.isTTY = previousStdin;
    process.stdout.isTTY = previousStdout;
  };
}

/** An untrusted Git workspace, with the trust store in a temporary HOME. */
function untrustedRepository(): string {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-serve-open-trust-')));
  cleanup.push(() => rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, 'home');
  const repo = join(scratch, 'repo');
  mkdirSync(home);
  execFileSync('git', ['init', '--quiet', repo]);
  const previousHome = process.env['HOME'];
  process.env['HOME'] = home;
  cleanup.push(() => {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
  });
  return repo;
}

describe('canAskServeOpenTrustQuestion', () => {
  it('is true only with an askable state and a TTY on both streams', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) });

    let restore = stubTty(true, true);
    try {
      expect(canAskServeOpenTrustQuestion(access)).toBe(true);

      restore();
      restore = stubTty(true, false);
      expect(canAskServeOpenTrustQuestion(access)).toBe(false);

      restore();
      restore = stubTty(false, true);
      expect(canAskServeOpenTrustQuestion(access)).toBe(false);
    } finally {
      restore();
    }
  });

  it('is false for a state a grant could not change, even with a TTY', () => {
    const restore = stubTty(true, true);
    try {
      const access = createRestrictedWorkspaceProjectAccess('store-unavailable', '/nowhere');
      expect(canAskServeOpenTrustQuestion(access)).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('askServeOpenTrustQuestion', () => {
  it('trusts and starts on a "y" answer, recording the grant', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) });
    const written: string[] = [];
    const ask = vi.fn(async () => 'y');

    const answer = await askServeOpenTrustQuestion(access, repo, {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      ask,
      write: (text) => written.push(text),
    });

    expect(ask).toHaveBeenCalledWith(
      'Trust this folder? [y] trust and start / [r] start Restricted / [N] quit: ',
    );
    expect(written.join('')).toContain(`This folder is not trusted: ${repo}`);
    expect(answer).toMatchObject({ decision: 'trust' });
    if (answer.decision !== 'trust') throw new Error('expected trust');
    expect(answer.access.status).toBe('trusted');
    // Recorded, so the next start is Trusted without asking.
    await expect(resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) })).resolves.toMatchObject({
      status: 'trusted',
    });
  });

  it('starts Restricted on an "r" answer, without recording anything', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) });
    const written: string[] = [];

    const answer = await askServeOpenTrustQuestion(access, repo, {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      ask: async () => 'r',
      write: (text) => written.push(text),
    });

    expect(answer).toEqual({ decision: 'restricted', access });
    expect(written.join('')).toContain('Starting Restricted.');
    await expect(resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) })).resolves.toMatchObject({
      status: 'restricted',
    });
  });

  it.each([['N'], [''], ['nope'], ['no']])('quits on %j, same as sidecar-trust.mjs', async (raw) => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) });
    const written: string[] = [];

    const answer = await askServeOpenTrustQuestion(access, repo, {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      ask: async () => raw,
      write: (text) => written.push(text),
    });

    expect(answer).toEqual({ decision: 'quit' });
    expect(written.join('')).toContain('Trust it later with: test-product trust --yes');
  });

  it('falls back to Restricted, saying so, when recording the grant fails', async () => {
    const repo = untrustedRepository();
    const access = await resolveInitialCliWorkspaceProjectAccess(repo, { productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }) });
    const written: string[] = [];

    const answer = await askServeOpenTrustQuestion(access, repo, {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      ask: async () => 'y',
      write: (text) => written.push(text),
      grant: async () => {
        throw new Error('store is read-only');
      },
    });

    expect(answer).toEqual({ decision: 'restricted', access });
    expect(written.join('')).toContain(
      'Could not record trust (store is read-only). Starting Restricted.',
    );
  });

  it('starts Restricted without asking where a grant cannot help', async () => {
    const ask = vi.fn(async () => 'y');
    const access = createRestrictedWorkspaceProjectAccess('store-unavailable', '/nowhere');

    const answer = await askServeOpenTrustQuestion(access, '/nowhere', {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),  ask });

    expect(ask).not.toHaveBeenCalled();
    expect(answer).toEqual({ decision: 'restricted', access });
  });
});
