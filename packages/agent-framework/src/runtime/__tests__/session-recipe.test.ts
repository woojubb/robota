import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRuntimeSession, createAgentRuntime } from '../../index.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('agent runtime session recipe', () => {
  it('is what createSession builds from, so a host or pool can build the same sessions', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'recipe-')));
    dirs.push(cwd);
    const scripted = createScriptedProvider([
      { text: 'from the pooled build' },
      { text: 'from the runtime' },
    ]);
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: scripted.provider,
    });
    const options = {
      bare: true,
      permissionMode: 'plan' as const,
      appendSystemPrompt: 'Be brief.',
      deniedTools: ['Bash'],
    };

    const recipe = runtime.sessionRecipe(options);
    expect(recipe).toEqual(
      expect.objectContaining({
        cwd,
        provider: scripted.provider,
        permissionMode: 'plan',
        appendSystemPrompt: 'Be brief.',
        deniedTools: ['Bash'],
      }),
    );

    // A session built from the recipe runs turns like one the runtime creates.
    const built = buildRuntimeSession(recipe);
    expect((await (await built.submit('hello')).completed).response).toBe('from the pooled build');

    // createSession works detached from the runtime object, as a borrowed function.
    const { createSession } = runtime;
    const borrowed = createSession({ bare: true });
    expect((await (await borrowed.submit('again')).completed).response).toBe('from the runtime');
  });
});
