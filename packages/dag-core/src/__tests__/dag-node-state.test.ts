import { describe, expect, it } from 'vitest';
import {
  applyRunProgressEventToNodeStateMap,
  applyRunResultToNodeStateMap,
  createDefaultDagNodeState,
  isDagNodeStateMapRunnable,
  markDagNodeOperationDone,
  markDagNodeOperationStarted,
  reconcileDagNodeStateMap,
  resetDagNodeExecutionStateMap,
  type IDagDefinition,
  type IDagNodeState,
} from '../index.js';

interface IDesignerNodeState extends IDagNodeState {
  isSelected: boolean;
}

const definition: Pick<IDagDefinition, 'nodes'> = {
  nodes: [
    {
      nodeId: 'source',
      nodeType: 'input',
      dependsOn: [],
      config: {},
    },
    {
      nodeId: 'output',
      nodeType: 'text-output',
      dependsOn: ['source'],
      config: {},
    },
  ],
};

function createDesignerState(nodeId: string): IDesignerNodeState {
  return {
    ...createDefaultDagNodeState(),
    isSelected: nodeId === 'source',
  };
}

describe('dag node orchestration state', () => {
  it('reconciles state map to the current definition nodes', () => {
    const state = reconcileDagNodeStateMap(
      definition,
      {
        removed: {
          operationStatus: 'idle',
          executionStatus: 'success',
          isSelected: false,
        },
      },
      { createState: createDesignerState },
    );

    expect(Object.keys(state)).toEqual(['source', 'output']);
    expect(state.source.isSelected).toBe(true);
    expect(state.output.executionStatus).toBe('idle');
  });

  it('gates runnability while a node side-effect operation is pending', () => {
    const initial = reconcileDagNodeStateMap(definition, {}, { createState: createDesignerState });
    const uploading = markDagNodeOperationStarted(
      initial,
      'source',
      {
        status: 'uploading',
        description: 'Uploading image.png...',
      },
      { createState: createDesignerState },
    );

    expect(uploading.source.pendingDescription).toBe('Uploading image.png...');
    expect(isDagNodeStateMapRunnable(uploading)).toBe(false);

    const done = markDagNodeOperationDone(uploading, 'source', {
      createState: createDesignerState,
    });

    expect(done.source.operationStatus).toBe('idle');
    expect(done.source.pendingDescription).toBeUndefined();
    expect(isDagNodeStateMapRunnable(done)).toBe(true);
  });

  it('projects task progress events into execution state and traces', () => {
    const initial = reconcileDagNodeStateMap(definition, {}, { createState: createDesignerState });
    const running = applyRunProgressEventToNodeStateMap(
      initial,
      {
        eventType: 'task.started',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeId: 'source',
        occurredAt: '2026-05-05T00:00:00.000Z',
        input: { prompt: 'hello' },
      },
      { createState: createDesignerState },
    );

    expect(running.source.executionStatus).toBe('running');
    expect(isDagNodeStateMapRunnable(running)).toBe(false);

    const completed = applyRunProgressEventToNodeStateMap(
      running,
      {
        eventType: 'task.completed',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeId: 'source',
        occurredAt: '2026-05-05T00:00:01.000Z',
        output: { text: 'hello' },
      },
      { createState: createDesignerState },
    );

    expect(completed.source.executionStatus).toBe('success');
    expect(completed.source.trace?.input).toEqual({ prompt: 'hello' });
    expect(completed.source.trace?.output).toEqual({ text: 'hello' });
    expect(isDagNodeStateMapRunnable(completed)).toBe(true);
  });

  it('resets execution state and applies final run results', () => {
    const initial = reconcileDagNodeStateMap(definition, {}, { createState: createDesignerState });
    const running = applyRunProgressEventToNodeStateMap(
      initial,
      {
        eventType: 'task.started',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeId: 'source',
        occurredAt: '2026-05-05T00:00:00.000Z',
      },
      { createState: createDesignerState },
    );
    const reset = resetDagNodeExecutionStateMap(definition, running, {
      createState: createDesignerState,
    });

    expect(reset.source.executionStatus).toBe('idle');
    expect(reset.source.trace).toBeUndefined();
    expect(reset.source.isSelected).toBe(true);

    const finished = applyRunResultToNodeStateMap(
      reset,
      {
        dagRunId: 'run-1',
        status: 'failed',
        traces: [
          {
            nodeId: 'source',
            nodeType: 'input',
            input: {},
            output: { text: 'hello' },
            estimatedCredits: 0,
            totalCredits: 0,
          },
        ],
        nodeErrors: [
          {
            nodeId: 'output',
            nodeType: 'text-output',
            occurredAt: '2026-05-05T00:00:02.000Z',
            error: {
              code: 'NODE_FAILED',
              category: 'task_execution',
              message: 'Node failed',
              retryable: false,
            },
          },
        ],
        totalCredits: 0,
      },
      { createState: createDesignerState },
    );

    expect(finished.source.executionStatus).toBe('success');
    expect(finished.source.trace?.output).toEqual({ text: 'hello' });
    expect(finished.output.executionStatus).toBe('failed');
  });
});
