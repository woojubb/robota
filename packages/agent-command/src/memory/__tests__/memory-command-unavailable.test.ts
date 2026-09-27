/**
 * #3282 §4c review finding: `/memory` in a served (GUI) session throws instead of answering, because
 * `executeMemoryCommand` never caught what `context.getMemoryStore()` throws when the host composed no
 * memory store (off by default, or unavailable on this host — `WorkspaceAuthorityRequiredError`). The
 * uncaught rejection reaches the transport's `command` handler
 * (`session-message-handler.ts`'s `.then(_, error => deliver({ type: 'protocol_error', ... }))`), which
 * the GUI renders as a `protocol_error` toast — the "red toast" the audit found — instead of the same
 * plain `command_result` every other unavailable-command case gets (mirrors `rewind-command.ts`'s
 * `formatError`, which already catches `EditCheckpointsUnavailableError` the same way).
 */
import { describe, expect, it } from 'vitest';

import { WorkspaceAuthorityRequiredError } from '@robota-sdk/agent-framework';

import { executeMemoryCommand } from '../memory-command.js';

import type { ICommandHostMemory, ICommandHostWorkspace } from '@robota-sdk/agent-framework';

function contextWithUnavailableMemory(): ICommandHostMemory & ICommandHostWorkspace {
  return {
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => {},
    getMemoryStore: () => {
      throw new WorkspaceAuthorityRequiredError("Project memory isn't available for this folder.");
    },
    getCwd: () => '/workspace',
    getCommandInvocationSource: () => 'user',
  };
}

describe('executeMemoryCommand — unavailable memory store', () => {
  it('answers list with a plain failure instead of rejecting', async () => {
    const result = await executeMemoryCommand(contextWithUnavailableMemory(), 'list');
    expect(result.success).toBe(false);
    expect(result.message).toBe("Project memory isn't available for this folder.");
  });

  it('answers show, pending, used and add the same way — never a throw', async () => {
    const context = contextWithUnavailableMemory();
    for (const args of ['show', 'pending', 'used', 'add project topic some durable fact']) {
      await expect(executeMemoryCommand(context, args)).resolves.toMatchObject({
        success: false,
        message: "Project memory isn't available for this folder.",
      });
    }
  });

  it('still lets an ordinary Error through as a plain failure, not a throw', async () => {
    const context: ICommandHostMemory & ICommandHostWorkspace = {
      getUsedMemoryReferences: () => [],
      recordMemoryEvent: () => {},
      getMemoryStore: () => {
        throw new Error('unexpected store failure');
      },
      getCwd: () => '/workspace',
      getCommandInvocationSource: () => 'user',
    };
    await expect(executeMemoryCommand(context, 'list')).resolves.toEqual({
      success: false,
      message: 'unexpected store failure',
    });
  });
});
