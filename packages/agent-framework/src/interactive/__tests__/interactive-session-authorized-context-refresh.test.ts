import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { InteractiveSession } from '../interactive-session.js';

const TEST_CONFIG = {
  defaultTrustLevel: 'moderate' as const,
  provider: { name: 'scripted', model: 'scripted', apiKey: undefined },
  permissions: { allow: [], deny: [] },
  env: {},
  taskContext: { enabled: false },
};

describe('InteractiveSession authorized context refresh', () => {
  it('emits a refresh event after an authorized project context file changes', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'robota-context-refresh-')));
    const agentsPath = join(cwd, 'AGENTS.md');
    await writeFile(agentsPath, '# Initial rules\n', 'utf8');
    const scripted = createScriptedProvider([{ text: 'first' }, { text: 'second' }]);
    const session = new InteractiveSession({
      cwd,
      provider: scripted.provider,
      projectAccess: await createTrustedProjectAccessFixture(cwd),
      config: TEST_CONFIG,
      permissionMode: 'bypassPermissions',
    });
    const refreshed: string[] = [];
    session.on('context_file_refreshed', (event) => refreshed.push(event.filePath));

    try {
      const first = await session.submit('initialize context');
      await first.completed;
      expect(session.listContextReferences().map((entry) => entry.relativePath)).toContain(
        'AGENTS.md',
      );
      await writeFile(agentsPath, '# Refreshed rules\n', 'utf8');
      const second = await session.submit('observe refreshed context');
      await second.completed;

      expect(refreshed).toEqual(['AGENTS.md']);
    } finally {
      await session.shutdown();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
