import { describe, expect, it, vi } from 'vitest';

import { executeBatch } from '../tool-execution-batch';
import { createLogger } from '../../utils/logger';
import type { IToolExecutionRequest } from '../../interfaces/service';
import type { IToolExecutionResult } from '../../interfaces/tool';

const requests = ['first', 'second', 'third'].map((executionId): IToolExecutionRequest => ({
  executionId,
  toolName: 'fixture',
  parameters: {},
  ownerType: 'tool',
  ownerId: executionId,
}));
const failure: IToolExecutionResult = {
  executionId: 'first',
  toolName: 'fixture',
  success: false,
  result: null,
  error: 'Controlled failure',
};

function executor() {
  return { executeTool: vi.fn().mockResolvedValue(failure) };
}

describe('sequential fail-fast outcomes', () => {
  it('pairs every call with a result without dispatching the skipped tail', async () => {
    const tool = executor();
    const beforeDispatch = vi.fn().mockResolvedValue(undefined);
    const onResult = vi.fn().mockResolvedValue(undefined);
    const output = await executeBatch(
      {
        requests,
        mode: 'sequential',
        continueOnError: false,
        journal: { beforeDispatch, onResult },
      },
      tool,
      createLogger('fixture'),
    );
    expect(output.results.map((result) => result.executionId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(output.results[0]).toEqual(failure);
    for (const result of output.results.slice(1)) {
      expect(result).toMatchObject({
        success: false,
        result: null,
        metadata: { errorCode: 'tool_call_skipped', dispatchStatus: 'not-dispatched' },
      });
    }
    expect(tool.executeTool).toHaveBeenCalledTimes(1);
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(3);
  });

  it.each(['executionId', 'ownerType', 'ownerId'] as const)(
    'refuses a skipped tail missing %s instead of publishing an invalid settlement',
    async (field) => {
      const malformed = { ...requests[1], [field]: undefined };
      const onResult = vi.fn();
      const tool = executor();
      const output = await executeBatch(
        {
          requests: [requests[0], malformed],
          mode: 'sequential',
          continueOnError: false,
          journal: { beforeDispatch: vi.fn(), onResult },
        },
        tool,
        createLogger('fixture'),
      );
      expect(output.results).toEqual([failure]);
      expect(output.errors).toHaveLength(2);
      expect(output.errors[1].message).toContain(`missing ${field}`);
      expect(onResult).toHaveBeenCalledTimes(1);
      expect(tool.executeTool).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves recovered real settlements after an earlier failure', async () => {
    const tool = executor();
    const completed: IToolExecutionResult = {
      executionId: 'second',
      toolName: 'fixture',
      success: true,
      result: 'already applied',
    };
    const output = await executeBatch(
      {
        requests,
        mode: 'sequential',
        continueOnError: false,
        recoveredResults: new Map([[1, completed]]),
      },
      tool,
      createLogger('fixture'),
    );
    expect(output.results[1]).toEqual(completed);
    expect(output.results[2].metadata?.errorCode).toBe('tool_call_skipped');
    expect(tool.executeTool).toHaveBeenCalledTimes(1);
  });

  it('restores settled failures and skipped outcomes without redispatch', async () => {
    const initial = await executeBatch(
      { requests, mode: 'sequential', continueOnError: false },
      executor(),
      createLogger('fixture'),
    );
    const tool = executor();
    const onResult = vi.fn();
    const restored = await executeBatch(
      {
        requests,
        mode: 'sequential',
        continueOnError: false,
        recoveredResults: new Map(initial.results.map((result, index) => [index, result])),
        journal: { beforeDispatch: vi.fn(), onResult },
      },
      tool,
      createLogger('fixture'),
    );
    expect(restored.results).toEqual(initial.results);
    expect(restored.results).toHaveLength(3);
    expect(tool.executeTool).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
