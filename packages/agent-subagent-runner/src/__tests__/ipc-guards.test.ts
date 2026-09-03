import { describe, expect, it } from 'vitest';

import {
  SUBAGENT_WORKER_MODE_FLAG,
  isSubagentWorkerChildMessage,
  isSubagentWorkerModeArgv,
  isSubagentWorkerParentMessage,
} from '../index.js';

import type { ISubagentWorkerStartPayload } from '../index.js';

/** A minimal but fully-formed start payload that passes the structural guard. */
function validStartPayload(): ISubagentWorkerStartPayload {
  return {
    taskId: 'agent_1',
    // ARCH-031: `permissionPolicy` is required at the spawn boundary, so a "fully-formed" payload
    // carries it. The `as unknown as` cast below is why this fixture could go stale silently.
    request: {
      agentType: 'tester',
      prompt: 'do work',
      permissionPolicy: 'inherit-allowlist',
      cwd: '/tmp/parent-checkout',
    },
    agentDefinition: { name: 'tester', description: 'Tests.', systemPrompt: 'Run tasks.' },
    parentConfig: {},
    parentContext: { agentsMd: '', projectNotesMd: '' },
    providerProfile: { type: 'openai', model: 'test-model' },
  } as unknown as ISubagentWorkerStartPayload;
}

describe('isSubagentWorkerParentMessage', () => {
  it('accepts each well-formed parent message variant', () => {
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: validStartPayload() })).toBe(
      true,
    );
    expect(isSubagentWorkerParentMessage({ type: 'send', prompt: 'continue' })).toBe(true);
    expect(isSubagentWorkerParentMessage({ type: 'cancel' })).toBe(true);
    expect(isSubagentWorkerParentMessage({ type: 'cancel', reason: 'stop' })).toBe(true);
  });

  it('rejects malformed or unknown parent messages', () => {
    expect(isSubagentWorkerParentMessage(undefined)).toBe(false);
    expect(isSubagentWorkerParentMessage(null)).toBe(false);
    expect(isSubagentWorkerParentMessage('start')).toBe(false);
    expect(isSubagentWorkerParentMessage({ type: 'bogus' })).toBe(false);
    expect(isSubagentWorkerParentMessage({ type: 'send' })).toBe(false);
    expect(isSubagentWorkerParentMessage({ type: 'cancel', reason: 42 })).toBe(false);
  });

  it('rejects a start message whose payload is missing required fields', () => {
    const payload = validStartPayload() as unknown as Record<string, unknown>;
    delete payload.providerProfile;
    expect(isSubagentWorkerParentMessage({ type: 'start', payload })).toBe(false);

    const noModel = validStartPayload() as unknown as { providerProfile: Record<string, unknown> };
    delete noModel.providerProfile.model;
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: noModel })).toBe(false);

    // ARCH-031: the policy is required at the boundary, so the guard must reject a payload without
    // it. Without this the worker's conditional spread silently omits the policy — CORE-025 lost
    // this exact field once already, and nothing caught it.
    const noPolicy = validStartPayload() as unknown as { request: Record<string, unknown> };
    delete noPolicy.request.permissionPolicy;
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: noPolicy })).toBe(false);

    // ARCH-010/ARCH-031: without `cwd` and without a `worktree`, `subagentExecutionRoot` has nothing
    // to return and the child's tools get no containment root — reachable over the wire.
    const noCwd = validStartPayload() as unknown as { request: Record<string, unknown> };
    delete noCwd.request.cwd;
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: noCwd })).toBe(false);

    // `worktree.path` wins over `request.cwd`, so a well-formed `cwd` does not rescue a malformed
    // worktree — the child would take the bad branch.
    const badWorktree = validStartPayload() as unknown as Record<string, unknown>;
    badWorktree.worktree = { path: 42 };
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: badWorktree })).toBe(false);

    const worktreeNotAnObject = validStartPayload() as unknown as Record<string, unknown>;
    worktreeNotAnObject.worktree = '/tmp/wt';
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: worktreeNotAnObject })).toBe(
      false,
    );
  });

  it('accepts a start payload carrying a well-formed worktree', () => {
    const withWorktree = validStartPayload() as unknown as Record<string, unknown>;
    withWorktree.worktree = { path: '/tmp/wt', branch: 'subagent/x' };
    expect(isSubagentWorkerParentMessage({ type: 'start', payload: withWorktree })).toBe(true);
  });
});

describe('isSubagentWorkerChildMessage', () => {
  it('accepts each well-formed child message variant', () => {
    expect(isSubagentWorkerChildMessage({ type: 'ready' })).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'text_delta', delta: 'partial' })).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'tool_start', toolName: 'Read' })).toBe(true);
    expect(
      isSubagentWorkerChildMessage({ type: 'tool_end', toolName: 'Read', success: true }),
    ).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'result', output: 'done' })).toBe(true);
    // CORE-024 (RUNTIME-47): a well-formed usage payload is accepted.
    expect(
      isSubagentWorkerChildMessage({
        type: 'result',
        output: 'done',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    ).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'error', message: 'boom' })).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'cancelled' })).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'cancelled', reason: 'stop' })).toBe(true);
  });

  it('rejects malformed or unknown child messages', () => {
    expect(isSubagentWorkerChildMessage(undefined)).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'result' })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'text_delta' })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'tool_end', toolName: 'Read' })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'error' })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'cancelled', reason: 7 })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'unknown' })).toBe(false);
  });

  it('validates the optional composed-tool-name declaration (ARCH-021)', () => {
    // Absent is valid — an old-shaped `ready` still passes.
    expect(isSubagentWorkerChildMessage({ type: 'ready' })).toBe(true);
    expect(
      isSubagentWorkerChildMessage({ type: 'ready', composedToolNames: ['Read', 'Write'] }),
    ).toBe(true);
    expect(isSubagentWorkerChildMessage({ type: 'ready', composedToolNames: [] })).toBe(true);

    // Present must be an array of strings: the guard narrows to a typed shape, so an unvalidated
    // field hands a consumer `readonly string[]` over whatever the wire carried.
    expect(isSubagentWorkerChildMessage({ type: 'ready', composedToolNames: 'Read' })).toBe(false);
    expect(
      isSubagentWorkerChildMessage({ type: 'ready', composedToolNames: [{ name: 'Read' }] }),
    ).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'ready', composedToolNames: 42 })).toBe(false);
  });

  it('rejects a result message with a malformed usage payload (CORE-024 RUNTIME-47)', () => {
    // Missing fields, wrong types, and non-object usage must all be rejected so a bad payload
    // cannot be spread verbatim into the parent's token/cost accounting.
    expect(
      isSubagentWorkerChildMessage({ type: 'result', output: 'done', usage: { promptTokens: 1 } }),
    ).toBe(false);
    expect(
      isSubagentWorkerChildMessage({
        type: 'result',
        output: 'done',
        usage: { promptTokens: '1', completionTokens: 2, totalTokens: 3 },
      }),
    ).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'result', output: 'done', usage: 42 })).toBe(false);
    expect(isSubagentWorkerChildMessage({ type: 'result', output: 'done', usage: null })).toBe(
      false,
    );
  });
});

/**
 * DIST-006. The test that stood here asserted `getDefaultSubagentWorkerPath()` returned "an
 * absolute path ending in child-process-subagent-worker.js" — and it PASSED for the whole time the
 * built binary could not spawn a subagent at all, because a string's shape says nothing about
 * whether the file is there. The resolver is gone; what is left to check is the argv contract.
 */
describe('subagent worker mode', () => {
  it('recognises the flag only when it is actually present', () => {
    expect(isSubagentWorkerModeArgv(['node', 'bin.js', SUBAGENT_WORKER_MODE_FLAG])).toBe(true);
    expect(isSubagentWorkerModeArgv(['/opt/robota', SUBAGENT_WORKER_MODE_FLAG])).toBe(true);
    expect(isSubagentWorkerModeArgv(['node', 'bin.js'])).toBe(false);
    expect(isSubagentWorkerModeArgv([])).toBe(false);
  });

  it('uses a flag no user would type, so normal invocations never enter worker mode', () => {
    // A plausible flag would turn a typo into a silently-started worker.
    expect(SUBAGENT_WORKER_MODE_FLAG.startsWith('--__')).toBe(true);
    for (const realistic of ['--help', '--version', '-p', '--print', '--model', '--worker']) {
      expect(isSubagentWorkerModeArgv(['node', 'bin.js', realistic])).toBe(false);
    }
  });
});
