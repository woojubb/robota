/**
 * Issue #3248: in `auto` mode a broad execution allow rule (`Bash(npm *)`) is dropped from the allow
 * list but stays in an `inherit-allowlist` ceiling, so a subagent's command inside the ceiling reaches
 * the sandbox step. An in-process subagent runs the parent's tools, under the parent's sandbox, and
 * its session consults that same sandbox there, as the parent's does.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

const approvingSandbox: ISandboxClient = {
  filesystem: 'shared',
  wrapCommand: (invocation) => invocation,
  autoApproves: () => true,
  run: () => Promise.reject(new Error('not used')),
  readFile: () => Promise.reject(new Error('not used')),
  writeFile: () => Promise.reject(new Error('not used')),
};

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function runSubagentBash(sandboxClient?: ISandboxClient): Promise<string[]> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-subagent-sandbox-')));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const ran: string[] = [];
  const bash = new FunctionTool(
    {
      name: 'Bash',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
    async (args) => {
      ran.push(String(args.command));
      return 'done';
    },
  );
  const deps = {
    config: {
      defaultTrustLevel: 'moderate',
      provider: { name: 'scripted', model: 'scripted-model' },
      permissions: { allow: ['Bash(npm *)'], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    tools: [bash],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    // Without the sandbox the call goes to the auto-mode classifier, which gets the next scripted
    // turn: prose, not a verdict, so the command is not approved.
    provider: createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: 'npm test' } }] },
      { text: 'finished' },
      { text: 'finished' },
    ]).provider,
    permissionMode: 'auto',
    customAgentRegistry: () => ({
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    }),
    ...(sandboxClient !== undefined ? { sandboxClient } : {}),
  } as unknown as IInProcessSubagentRunnerDeps;

  await createInProcessSubagentRunner(deps)
    .start({
      taskId: 'agent_1',
      request: {
        permissionPolicy: 'inherit-allowlist',
        agentType: 'tester',
        parentSessionId: 'parent',
        depth: 1,
        cwd,
        prompt: 'run the tests',
      },
    } as never)
    .result.catch(() => undefined);
  return ran;
}

describe('an in-process subagent in auto mode and the parent sandbox', () => {
  it('runs a confined command inside its ceiling that the sandbox approves', async () => {
    expect(await runSubagentBash(approvingSandbox)).toEqual(['npm test']);
  });

  it('without a sandbox, the same command is not approved on the sandbox’s say-so', async () => {
    expect(await runSubagentBash()).toEqual([]);
  });
});
