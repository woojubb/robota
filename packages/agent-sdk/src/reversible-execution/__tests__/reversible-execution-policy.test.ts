import { describe, expect, it, vi } from 'vitest';
import type {
  IEventService,
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';
import {
  evaluateReversibleToolSafety,
  wrapReversibleExecutionTools,
} from '../reversible-execution-policy.js';

function createTool(name: string, execute: () => Promise<IToolResult>): IToolWithEventService {
  const schema: IToolSchema = {
    name,
    description: `${name} test tool`,
    parameters: { type: 'object', properties: {} },
  };
  return {
    schema,
    setEventService: (_eventService: IEventService | undefined) => undefined,
    execute: async (_parameters: TToolParameters, _context: IToolExecutionContext) => execute(),
    validate: () => true,
    validateParameters: (): IParameterValidationResult => ({ isValid: true, errors: [] }),
    getDescription: () => schema.description,
    getName: () => name,
  };
}

describe('reversible execution policy', () => {
  it('classifies checkpointed Write and Edit calls as reversible file mutations', () => {
    const report = evaluateReversibleToolSafety({
      toolName: 'Write',
      toolArgs: { filePath: 'src/example.ts' },
      context: { checkpointAvailable: true, isolation: 'none' },
    });

    expect(report).toMatchObject({
      reversible: true,
      sideEffect: 'file-mutation',
      rollbackLayer: 'edit-checkpoint',
      status: 'reversible',
    });
  });

  it('requires isolation for host Bash side effects in local-first reversible mode', () => {
    const report = evaluateReversibleToolSafety({
      toolName: 'Bash',
      toolArgs: { command: 'touch generated.txt' },
      context: { checkpointAvailable: true, isolation: 'none' },
    });

    expect(report).toMatchObject({
      reversible: false,
      sideEffect: 'shell-process',
      rollbackLayer: 'none',
      status: 'requires-isolation',
    });
  });

  it('treats worktree-isolated Agent jobs as reversible through the worktree layer', () => {
    const report = evaluateReversibleToolSafety({
      toolName: 'Agent',
      toolArgs: {
        jobs: [
          { prompt: 'edit package a', isolation: 'worktree' },
          { prompt: 'edit package b', isolation: 'worktree' },
        ],
      },
      context: { checkpointAvailable: true, isolation: 'none' },
    });

    expect(report).toMatchObject({
      reversible: true,
      sideEffect: 'subagent',
      rollbackLayer: 'worktree',
      status: 'reversible',
    });
  });

  it('blocks untracked command side effects before the wrapped tool executes', async () => {
    const execute = vi.fn(async () => ({ success: true, data: 'ran' }));
    const [wrapped] = wrapReversibleExecutionTools([createTool('Bash', execute)], {
      mode: 'local-first',
      checkpointAvailable: true,
    });

    const result = await wrapped!.execute(
      { command: 'touch generated.txt' },
      { toolName: 'Bash', parameters: {} },
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      success: false,
      reversibleSafety: {
        status: 'requires-isolation',
        rollbackLayer: 'none',
      },
    });
  });
});
