/**
 * `--no-session-persistence` reaches the workspace composition that builds the edit checkpoint
 * stores. `cli-core` has no seam a test can drive, so this pins the hop `buildCommandSetup` owns: the
 * parsed flag in, the composition option out.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from './helpers/product-runtime.js';
import { buildCommandSetup } from '../startup/command-setup.js';
import { createCliWorkspaceComposition } from '../startup/workspace-project-composition.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

vi.mock('../startup/workspace-project-composition.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../startup/workspace-project-composition.js')>();
  return { ...actual, createCliWorkspaceComposition: vi.fn(actual.createCliWorkspaceComposition) };
});

const homes: string[] = [];

afterEach(() => {
  vi.mocked(createCliWorkspaceComposition).mockClear();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function composeWith(args: Partial<IParsedCliArgs>): Record<string, unknown> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-setup-persistence-')));
  homes.push(home);
  buildCommandSetup(
    home,
    { noUpdateCheck: true, ...args } as IParsedCliArgs,
    { productRuntime: createTestProductRuntime('test-product', { HOME: home }) },
    '0.0.0-test',
  );
  // The first call is the setup's own; later ones belong to the doctor inputs built after it.
  const call = vi.mocked(createCliWorkspaceComposition).mock.calls[0];
  if (call === undefined) throw new Error('the composition was not built');
  return call[0] as unknown as Record<string, unknown>;
}

describe('buildCommandSetup and --no-session-persistence', () => {
  it('asks the workspace composition for ephemeral edit checkpoints when the flag is set', () => {
    expect(composeWith({ noSessionPersistence: true })).toMatchObject({
      ephemeralEditCheckpoints: true,
    });
  });

  it('leaves the project’s checkpoint directory in use when it is not', () => {
    expect(composeWith({ noSessionPersistence: false })).not.toHaveProperty(
      'ephemeralEditCheckpoints',
    );
  });
});
