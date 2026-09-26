/**
 * Issue #3248: a `context: fork` skill runs in a subagent session that carries no background policy,
 * so the parent's own gate decides its calls. Its inherited shell tools run under the parent's
 * sandbox, and the fork consults that sandbox: a confined command it approves needs no one to ask.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';
import { createNodeHostContributionSourcesFixture } from '../contribution-source-fixture.js';
import { createTrustedProjectAccessFixture } from '../trusted-project-state-fixture.js';

import type { ICommandModule } from '../../command-api/index.js';

type TSandboxClient = NonNullable<Parameters<typeof scriptedSession>[0]['sandboxClient']>;

/** A fork runs on the agent runtime, which a session builds only when a module asks for it. */
const agentRuntimeModule: ICommandModule = {
  name: 'fork-sandbox-fixture',
  sessionRequirements: ['agent-runtime'],
  systemCommands: [],
};

/** Confines nothing for real: the command runs on the host, and the sandbox approves it. */
const approvingSandbox: TSandboxClient = {
  filesystem: 'shared',
  wrapCommand: (invocation) => invocation,
  autoApproves: () => true,
  run: () => Promise.reject(new Error('not used')),
  readFile: () => Promise.reject(new Error('not used')),
  writeFile: () => Promise.reject(new Error('not used')),
};

let workspace: string | undefined;
let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

async function runForkSkill(sandboxClient?: TSandboxClient): Promise<boolean> {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-fork-sandbox-')));
  const skillDir = join(workspace, '.agents', 'skills', 'run-tests');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    ['---', 'name: run-tests', 'description: Run the tests', 'context: fork', '---', 'Run them.'].join(
      '\n',
    ),
  );
  harness = scriptedSession({
    cwd: workspace,
    contributionSources: createNodeHostContributionSourcesFixture(workspace),
    skillRoots: [{ root: join('.agents', 'skills'), kind: 'skills' }],
    projectAccess: await createTrustedProjectAccessFixture(workspace),
    permissionMode: 'default',
    commandModules: [agentRuntimeModule],
    ...(sandboxClient !== undefined ? { sandboxClient } : {}),
    turns: [
      { text: 'parent warmed' },
      { toolCalls: [{ name: 'Bash', args: { command: 'printf fork > fork-ran.txt' } }] },
      { text: 'fork done' },
    ],
  });
  await harness.submit('Warm up.');
  // The model-invoked path awaits the fork, so the command has run (or been refused) on return.
  const result = await harness.session.executeSkillCommandByName('run-tests', '', {
    invocationSource: 'model',
  });
  expect(result?.success).toBe(true);
  return existsSync(join(workspace, 'fork-ran.txt'));
}

describe('a fork skill and the parent sandbox', () => {
  it('runs a confined command the sandbox approves, with no one to ask', async () => {
    expect(await runForkSkill(approvingSandbox)).toBe(true);
  });

  it('without a sandbox, the same command is not run unattended', async () => {
    expect(await runForkSkill()).toBe(false);
  });
});
