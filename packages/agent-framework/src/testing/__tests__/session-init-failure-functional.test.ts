import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession } from '../index.js';
import { createTrustedProjectAccessFixture } from '../trusted-project-state-fixture.js';

import type { ICommandModule } from '../../command-api/index.js';
import type { IContributionSource } from '../../contributions/contribution-source.js';

const DISCOVERY_FAILURE = 'skill root is unreadable';

/** A contribution source whose discovery fails, so session initialization rejects. */
const failingSource: IContributionSource = {
  kind: 'host',
  displayName: 'failing host',
  readText: () => undefined,
  listDirectory: () => {
    throw new Error(DISCOVERY_FAILURE);
  },
  inspectKind: () => 'directory',
};

/** Skills are listed to the model only when a skill-activation command exists. */
const skillActivationModule: ICommandModule = {
  name: 'init-failure-fixture',
  systemCommands: [
    {
      name: 'skills',
      description: 'Activate a discovered skill.',
      semanticRole: 'skillActivation',
      modelInvocable: true,
      userInvocable: true,
      requiresPermission: false,
      lifecycle: 'inline',
      execute: async () => ({ success: false, message: 'unused' }),
    },
  ],
};

let workspace: string | undefined;
afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe('a session whose initialization failed', () => {
  it('reports the failure cause to a readiness probe instead of "not initialized"', async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-init-failure-')));
    const harness = scriptedSession({
      cwd: workspace,
      contributionSources: [failingSource],
      skillRoots: [{ root: 'skills', kind: 'skills' }],
      projectAccess: await createTrustedProjectAccessFixture(workspace),
      commandModules: [skillActivationModule],
      turns: [{ text: 'never requested' }],
    });

    await expect(harness.session.submit('Start.')).rejects.toThrow(DISCOVERY_FAILURE);
    // The terminal's init poller reads context state; it must see the cause and stop waiting.
    expect(() => harness.session.getContextState()).toThrow(DISCOVERY_FAILURE);
    await expect(harness.dispose()).rejects.toThrow(DISCOVERY_FAILURE);
  });
});
