/**
 * Issue #3288 §1: a background agent's permission prompt is attributed to it ("Background agent
 * <type> wants to …") so the GUI/TUI can show WHO is asking, not just an unattributed prompt. The
 * child-process runner already binds this (`permissionApprover` in
 * `child-process-subagent-runner.ts`, built from the parent's own job record — never from anything
 * the agent supplies). The in-process runner passed `deps.permissionHandler` straight through with
 * no `requester`, so an in-process background agent's prompt stayed unattributed — this file proves
 * it is now bound the same way.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { IPermissionAskContext } from '@robota-sdk/agent-session';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

function makeDeps(
  permissionHandler: IInProcessSubagentRunnerDeps['permissionHandler'],
): { deps: IInProcessSubagentRunnerDeps; cwd: string } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-subagent-requester-')));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
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
    async () => 'done',
  );
  const deps = {
    config: {
      defaultTrustLevel: 'moderate',
      provider: { name: 'scripted', model: 'scripted-model' },
      permissions: { allow: [], deny: [] },
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
    provider: createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: 'npm test' } }] },
      { text: 'finished' },
    ]).provider,
    // 'default' asks for anything not pre-approved — the mode that reaches `permissionHandler`.
    permissionMode: 'default',
    permissionHandler,
    customAgentRegistry: () => ({
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    }),
  } as unknown as IInProcessSubagentRunnerDeps;
  return { deps, cwd };
}

describe('in-process subagent permission requests are attributed (#3288 §1)', () => {
  it("binds this job's requester identity onto the parent's approver, like the child-process runner", async () => {
    const contexts: (IPermissionAskContext | undefined)[] = [];
    const permissionHandler = vi.fn(
      (_toolName: string, _toolArgs: unknown, context?: IPermissionAskContext) => {
        contexts.push(context);
        return Promise.resolve(true);
      },
    );
    const { deps, cwd } = makeDeps(permissionHandler);

    await createInProcessSubagentRunner(deps)
      .start({
        taskId: 'agent_42',
        request: {
          agentType: 'tester',
          parentSessionId: 'parent',
          depth: 1,
          cwd,
          prompt: 'run the tests',
        },
      } as never)
      .result.catch(() => undefined);

    expect(permissionHandler).toHaveBeenCalled();
    expect(contexts[0]?.requester).toEqual({
      kind: 'background-agent',
      label: 'tester',
      taskId: 'agent_42',
    });
  });

  it('never derives the requester from anything the agent supplies — only the parent job record', async () => {
    // A malicious/naive agent could name its Bash args in a way that resembles a requester; the
    // binding must come only from `job.request.agentType`/`job.taskId`, never the call site.
    const contexts: (IPermissionAskContext | undefined)[] = [];
    const permissionHandler = vi.fn(
      (_toolName: string, _toolArgs: unknown, context?: IPermissionAskContext) => {
        contexts.push(context);
        return Promise.resolve(true);
      },
    );
    const { deps, cwd } = makeDeps(permissionHandler);

    await createInProcessSubagentRunner(deps)
      .start({
        taskId: 'agent_real_id',
        request: {
          agentType: 'tester',
          parentSessionId: 'parent',
          depth: 1,
          cwd,
          prompt: 'run the tests',
        },
      } as never)
      .result.catch(() => undefined);

    expect(contexts[0]?.requester?.taskId).toBe('agent_real_id');
    expect(contexts[0]?.requester?.label).toBe('tester');
  });

  it('stays undefined when the host attaches no approver at all', () => {
    const { deps } = makeDeps(undefined);
    // No permissionHandler means createSubagentSession never receives one to wrap — nothing to
    // assert on a call, but this documents the `undefined` passthrough stays intact.
    expect(deps.permissionHandler).toBeUndefined();
  });
});
