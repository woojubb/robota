/**
 * The plugin skills a session loaded reach the prompt through session start-up, so the model is
 * told about the same plugin skills the router runs.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInteractiveSession } from '../interactive-session-init.js';

const originalHome = process.env.HOME;
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-plugin-skill-prompt-')));
  process.env.HOME = root;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(root, { recursive: true, force: true });
});

describe('plugin skills at session start', () => {
  it('are named in the prompt the session builds', async () => {
    const { session } = await createInteractiveSession({
      cwd: root,
      provider: createScriptedProvider([]).provider,
      onTextDelta: () => {},
      onToolExecution: () => {},
      commandDescriptors: [
        {
          name: 'skills',
          kind: 'builtin-command',
          description: 'Run a skill',
          userInvocable: true,
          modelInvocable: true,
        },
      ],
      commandSemanticRoles: { skillActivation: 'skills' },
      pluginSkills: [
        {
          name: 'tidy-plugin-skill',
          description: '(helper) Tidy the workspace',
          source: 'plugin',
          skillContent: 'Tidy.',
        },
      ],
    });

    expect(session.getSystemMessage()).toContain('tidy-plugin-skill');
  });
});
