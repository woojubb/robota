import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import { createTrustedProjectAccessFixture } from '../trusted-project-state-fixture.js';
import { createNodeHostContributionSourcesFixture } from '../contribution-source-fixture.js';

import type { ICommandModule } from '../../command-api/index.js';

const TEST_TIMEOUT = 20_000;
const PRIVATE_BODY = 'PRIVATE-SKILL-BODY-2d153f';
const skillActivationModule: ICommandModule = {
  name: 'strict-skill-fixture',
  systemCommands: [
    {
      name: 'skills',
      description: 'Activate a discovered skill.',
      semanticRole: 'skillActivation',
      modelInvocable: true,
      userInvocable: true,
      requiresPermission: false,
      lifecycle: 'inline',
      execute: async (context, name) =>
        (await context.executeSkillCommandByName(name, '', {
          invocationSource: context.getCommandInvocationSource(),
          displayInput: `/${name}`,
          rawInput: `/${name}`,
        })) ?? { success: false, message: `Unknown skill: ${name}` },
    },
  ],
};

let workspace: string | undefined;
let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

function seedSkill(root: string, name: string, disabled: string, body: string): void {
  const directory = join(root, '.robota', 'skills', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${name} description`,
      `disable-model-invocation: ${disabled}`,
      '---',
      body,
    ].join('\n'),
  );
}

describe('strict skill discovery through a real session', () => {
  it(
    'omits disabled skills from the provider prompt and refuses model activation',
    async () => {
      workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-strict-skills-')));
      seedSkill(workspace, 'visible-strict-skill', 'false', 'Visible skill body.');
      seedSkill(workspace, 'private-strict-skill', 'true', PRIVATE_BODY);
      harness = scriptedSession({
        cwd: workspace,
        contributionSources: createNodeHostContributionSourcesFixture(workspace),
        skillRoots: [{ root: join('.robota', 'skills'), kind: 'skills' }],
        projectAccess: await createTrustedProjectAccessFixture(workspace),
        commandModules: [skillActivationModule],
        turns: [
          {
            toolCalls: [{ name: 'command_skills', args: { args: 'private-strict-skill' } }],
          },
          { text: 'The private skill was not activated.' },
        ],
      });

      await harness.submit('Inspect the available skills.');

      const initialSystem = harness.requests[0]?.filter((message) => message.role === 'system');
      expect(JSON.stringify(initialSystem)).toContain('visible-strict-skill');
      expect(JSON.stringify(initialSystem)).not.toContain('private-strict-skill');
      expect(JSON.stringify(harness.requests[1])).toContain('Skill is not model-invocable');
      expect(JSON.stringify(harness.requests)).not.toContain(PRIVATE_BODY);
      expect(harness.toolCalls()).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'refuses malformed authority metadata before making any provider request',
    async () => {
      workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-strict-skills-')));
      seedSkill(workspace, 'malformed-strict-skill', 'treu', PRIVATE_BODY);
      harness = scriptedSession({
        cwd: workspace,
        contributionSources: createNodeHostContributionSourcesFixture(workspace),
        skillRoots: [{ root: join('.robota', 'skills'), kind: 'skills' }],
        projectAccess: await createTrustedProjectAccessFixture(workspace),
        commandModules: [skillActivationModule],
        turns: [{ text: 'This must never be requested.' }],
      });

      await expect(harness.session.submit('Start.')).rejects.toThrow(/disable-model-invocation/);
      expect(harness.requests).toHaveLength(0);
      // Shutdown observes the same rejected initialization promise; assert it explicitly.
      await expect(harness.dispose()).rejects.toThrow(/disable-model-invocation/);
      harness = undefined;
    },
    TEST_TIMEOUT,
  );
});
