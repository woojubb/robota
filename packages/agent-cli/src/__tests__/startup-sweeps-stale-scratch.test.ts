/**
 * A start removes the scratch directories a process that died left in the state root. No exit
 * handler can: the process never ran one, and the conversation content in those directories would
 * otherwise stay on disk. Drives the real entry point in print mode as the run that finds them.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { readCurrentProcessIdentity } from '@robota-sdk/agent-core/node';
import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../cli.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const DEAD_PID = 2_147_000_000;
const originalArgv = process.argv;
const originalHome = process.env.HOME;
const originalKey = process.env['PRODUCT_SCRATCH_SWEEP_TEST_KEY'];
const roots: string[] = [];

const providerDefinition: IProviderDefinition = {
  type: 'scratch-sweep-test',
  defaults: { model: 'test-model', apiKey: '$ENV:PRODUCT_SCRATCH_SWEEP_TEST_KEY' },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'scratch-sweep-test',
    version: 'test',
    async chat() {
      return {
        id: 'assistant-1',
        role: 'assistant',
        content: 'a reply',
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** A scratch directory holding conversation content, as `pid`'s run would have left it. */
function leave(parent: string, prefix: string, pid: number): string {
  const owner = pid === process.pid ? readCurrentProcessIdentity() : goneProcessOwner(pid);
  return leaveProcessScopedDirectory(parent, prefix, owner);
}

beforeEach(() => {
  process.env['PRODUCT_SCRATCH_SWEEP_TEST_KEY'] = 'test-only-key';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = originalArgv;
  process.env.HOME = originalHome;
  if (originalKey === undefined) delete process.env['PRODUCT_SCRATCH_SWEEP_TEST_KEY'];
  else process.env['PRODUCT_SCRATCH_SWEEP_TEST_KEY'] = originalKey;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('starting a print run', () => {
  it('removes the scratch directories a dead process left in the state root and keeps a live one', async () => {
    const home = tempRoot('test-product-scratch-sweep-home-');
    const project = tempRoot('test-product-scratch-sweep-project-');
    process.env.HOME = home;
    const productRuntime = createTestProductRuntime('test-product', {
      HOME: home,
      PRODUCT_SCRATCH_SWEEP_TEST_KEY: 'test-only-key',
    });
    const { spill, editor } = productRuntime.layout.userPaths;
    const editorPrefix = basename(productRuntime.vocabulary.editorTemporaryDirectoryPrefix);
    const stale = [
      leave(spill, 'agent-tool-results-', DEAD_PID),
      leave(editor, editorPrefix, DEAD_PID),
    ];
    const live = leave(spill, 'agent-tool-results-', process.pid);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'test-product', '-p', 'say hello'];

    await expect(
      startCli({ productRuntime, providerDefinitions: [providerDefinition] }),
    ).rejects.toThrow('process.exit:0');

    for (const directory of stale) expect(existsSync(directory), directory).toBe(false);
    expect(existsSync(live)).toBe(true);
  });
});
