import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../canonical-temp-dir.js';
import { InteractiveSession } from '../../interactive/interactive-session.js';
import { createTrustedProjectAccessFixture } from '../trusted-project-state-fixture.js';
import { createTestFrameworkHost } from '../framework-host.js';

const testHost = createTestFrameworkHost();

let workspace: string | undefined;
let session: InteractiveSession | undefined;

afterEach(async () => {
  await session?.shutdown();
  session = undefined;
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe('host-selected model identifiers through a real session', () => {
  it('uses the second product’s prompt enclosure and command tool name', async () => {
    workspace = makeCanonicalTempDir('acme-model-identity-');
    writeFileSync(join(workspace, 'guide.md'), 'ACME guidance', 'utf8');
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    session = new InteractiveSession({
      host: testHost,
      cwd: workspace,
      provider: scripted.provider,
      bare: true,
      permissionMode: 'bypassPermissions',
      projectAccess: await createTrustedProjectAccessFixture(workspace),
      promptFileReferenceTag: 'acme_file_references',
      modelCommandToolPrefix: 'acme_command_',
      commandModules: [
        {
          name: 'acme-echo',
          systemCommands: [
            {
              name: 'echo',
              description: 'Echo',
              modelInvocable: true,
              lifecycle: 'blocking',
              execute: async () => ({ success: true, message: 'ok' }),
            },
          ],
        },
      ],
    });

    const tools = await session.listRuntimeTools();
    expect(tools.map((tool) => tool.name)).toContain('acme_command_echo');
    await session.submit('Read @guide.md');
    const request = JSON.stringify(scripted.requests[0]);
    expect(request).toContain('<acme_file_references>');
    expect(request).toContain('ACME guidance');
    expect(request).not.toContain('agent_file_references');
  });
});
