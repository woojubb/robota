import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { retrieveAgentToolDeps } from '../../tools/agent-tool.js';
import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import { createTrustedProjectAccessFixture } from '../trusted-project-state-fixture.js';

import type { ICommandModule } from '../../command-api/index.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

let workspace: string | undefined;
let harness: ScriptedSessionHarness | undefined;
const skillActivationModule: ICommandModule = {
  name: 'skill-model-fixture',
  sessionRequirements: ['agent-runtime'],
  systemCommands: [
    {
      name: 'skills',
      description: 'Activate a skill.',
      semanticRole: 'skillActivation',
      modelInvocable: true,
      userInvocable: true,
      requiresPermission: false,
      lifecycle: 'inline',
      execute: () => ({ success: true, message: 'fixture' }),
    },
  ],
};
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

function seedSkill(name: string, model?: string): void {
  if (!workspace) throw new Error('missing fixture workspace');
  const directory = join(workspace, '.agents', 'skills', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${name} description`,
      'context: fork',
      'agent: Explorer',
      ...(model ? [`model: ${model}`] : []),
      '---',
      'Answer the audit request.',
    ].join('\n'),
  );
}

function seedAgent(): void {
  if (!workspace) throw new Error('missing fixture workspace');
  const directory = join(workspace, '.agents', 'agents');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'Explorer.md'),
    [
      '---',
      'name: Explorer',
      'description: Fixture explorer',
      'model: agent-model',
      '---',
      'Answer briefly.',
    ].join('\n'),
  );
}

describe('fork skill model through a real scripted child Session', () => {
  it('applies a skill model for one child request without changing agent or parent defaults', async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-skill-model-')));
    seedAgent();
    seedSkill('override', 'skill-model');
    seedSkill('inherit');
    seedSkill('fail', 'failing-skill-model');
    const scripted = createScriptedProvider([
      { text: 'parent warmed' },
      { text: 'child response 1' },
      { text: 'child response 2' },
      { text: 'child response 3' },
    ]);
    const attemptedModels: Array<string | undefined> = [];
    const provider: IAIProvider = {
      ...scripted.provider,
      chat: (messages, options) => {
        attemptedModels.push(options?.model);
        if (options?.model === 'failing-skill-model') {
          return Promise.reject(new Error('scripted child failure'));
        }
        return scripted.provider.chat(messages, options);
      },
    };
    harness = scriptedSession({
      cwd: workspace,
      projectAccess: await createTrustedProjectAccessFixture(workspace),
      agentDefinitionRoots: [join('.agents', 'agents')],
      model: 'parent-model',
      commandModules: [skillActivationModule],
      record: { provider, toCassette: join(workspace, 'skill-model-cassette.json') },
    });
    await harness.submit('Warm up.');

    const parent = harness.session.getSession();
    const errors: Error[] = [];
    harness.session.on('error', (error) => errors.push(error));
    const definition = retrieveAgentToolDeps(parent)?.customAgentRegistry?.('Explorer');
    expect(definition?.model).toBe('agent-model');

    const override = await harness.session.executeSkillCommandByName('override', '', {
      invocationSource: 'user',
      displayInput: '/override',
      rawInput: '/override',
    });
    const inherited = await harness.session.executeSkillCommandByName('inherit', '', {
      invocationSource: 'user',
      displayInput: '/inherit',
      rawInput: '/inherit',
    });
    expect(override?.success).toBe(true);
    expect(inherited?.success).toBe(true);
    expect(scripted.chatOptions.map((options) => options?.model)).toEqual([
      'parent-model',
      'skill-model',
      'agent-model',
    ]);
    expect(parent.getModelId()).toBe('parent-model');
    expect(definition?.model).toBe('agent-model');

    await harness.session.executeSkillCommandByName('fail', '', {
      invocationSource: 'user',
      displayInput: '/fail',
      rawInput: '/fail',
    });
    expect(errors.map((error) => error.message)).toContain('scripted child failure');
    const afterFailure = await harness.session.executeSkillCommandByName('inherit', '', {
      invocationSource: 'user',
      displayInput: '/inherit',
      rawInput: '/inherit',
    });
    expect(afterFailure?.success).toBe(true);
    expect(scripted.chatOptions.map((options) => options?.model)).toEqual([
      'parent-model',
      'skill-model',
      'agent-model',
      'agent-model',
    ]);
    expect(attemptedModels).toEqual([
      'parent-model',
      'skill-model',
      'agent-model',
      'failing-skill-model',
      'agent-model',
    ]);
    expect(parent.getModelId()).toBe('parent-model');
    expect(definition?.model).toBe('agent-model');
  }, 20_000);

  it('refuses an inject skill carrying a model before a provider request', async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-invalid-skill-model-')));
    const directory = join(workspace, '.agents', 'skills', 'invalid');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'SKILL.md'),
      [
        '---',
        'name: invalid',
        'description: Invalid inject model',
        'model: child-model',
        '---',
        'This cannot be registered.',
      ].join('\n'),
    );
    harness = scriptedSession({
      cwd: workspace,
      projectAccess: await createTrustedProjectAccessFixture(workspace),
      commandModules: [skillActivationModule],
      turns: [{ text: 'must not run' }],
    });
    await expect(harness.session.submit('Start.')).rejects.toThrow(/model/);
    expect(harness.requests).toHaveLength(0);
    await expect(harness.dispose()).rejects.toThrow(/model/);
    harness = undefined;
  }, 20_000);
});
