import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';

import {
  getDefaultSubagentWorkerPath,
  isSubagentWorkerChildMessage,
  isSubagentWorkerParentMessage,
} from '../index.js';

import type { ISubagentWorkerStartPayload } from '../index.js';

/** A minimal but fully-formed start payload that passes the structural guard. */
function validStartPayload(): ISubagentWorkerStartPayload {
  return {
    jobId: 'agent_1',
    request: { type: 'tester', prompt: 'do work' },
    agentDefinition: { name: 'tester', systemPrompt: 'Run tasks.' },
    parentConfig: {},
    parentContext: {},
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

describe('getDefaultSubagentWorkerPath', () => {
  it('resolves to an absolute path ending in the worker module', () => {
    const path = getDefaultSubagentWorkerPath();
    expect(isAbsolute(path)).toBe(true);
    expect(path.endsWith('child-process-subagent-worker.js')).toBe(true);
  });
});
