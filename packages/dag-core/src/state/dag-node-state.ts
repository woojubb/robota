import { TASK_PROGRESS_EVENTS } from '../constants/events.js';
import type { IDagDefinition } from '../types/domain.js';
import type { IRunNodeTrace, IRunResult } from '../types/run-result.js';
import type { TRunProgressEvent } from '../types/run-progress.js';
import type {
  IDagNodeExecutionTrace,
  IDagNodeState,
  TNodeOperationStatus,
} from '../types/node-state.js';

export interface IDagNodeOperationInput {
  status: Exclude<TNodeOperationStatus, 'idle'>;
  description: string;
}

export interface INodeStateReducerOptions<TState extends IDagNodeState> {
  createState?: (nodeId: string) => TState;
}

export function createDefaultDagNodeState(): IDagNodeState {
  return {
    operationStatus: 'idle',
    executionStatus: 'idle',
  };
}

export function reconcileDagNodeStateMap<TState extends IDagNodeState>(
  definition: Pick<IDagDefinition, 'nodes'>,
  currentState: Record<string, TState>,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const nextState: Record<string, TState> = {};
  for (const node of definition.nodes) {
    nextState[node.nodeId] = getStateOrDefault(currentState, node.nodeId, options);
  }
  return nextState;
}

export function markDagNodeOperationStarted<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  nodeId: string,
  operation: IDagNodeOperationInput,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const existing = getStateOrDefault(currentState, nodeId, options);
  return {
    ...currentState,
    [nodeId]: {
      ...existing,
      operationStatus: operation.status,
      pendingDescription: operation.description,
    },
  };
}

export function markDagNodeOperationDone<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  nodeId: string,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const existing = getStateOrDefault(currentState, nodeId, options);
  return {
    ...currentState,
    [nodeId]: {
      ...existing,
      operationStatus: 'idle',
      pendingDescription: undefined,
    },
  };
}

export function resetDagNodeExecutionStateMap<TState extends IDagNodeState>(
  definition: Pick<IDagDefinition, 'nodes'>,
  currentState: Record<string, TState>,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const reconciled = reconcileDagNodeStateMap(definition, currentState, {
    createState: options?.createState,
  });
  const nextState: Record<string, TState> = {};
  for (const [nodeId, state] of Object.entries(reconciled)) {
    nextState[nodeId] = {
      ...state,
      executionStatus: 'idle',
      trace: undefined,
    };
  }
  return nextState;
}

export function resetDagNodeExecutionStateFromNode<TState extends IDagNodeState>(
  definition: Pick<IDagDefinition, 'nodes'> & Partial<Pick<IDagDefinition, 'edges'>>,
  currentState: Record<string, TState>,
  nodeId: string,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const affectedNodeIds = collectNodeAndDownstreamIds(definition, nodeId);
  const reconciled = reconcileDagNodeStateMap(definition, currentState, {
    createState: options?.createState,
  });
  const nextState: Record<string, TState> = { ...reconciled };
  for (const affectedNodeId of affectedNodeIds) {
    const existing = getStateOrDefault(nextState, affectedNodeId, options);
    nextState[affectedNodeId] = {
      ...existing,
      executionStatus: 'idle',
      trace: undefined,
    };
  }
  return nextState;
}

export function overwriteDagNodeExecutionTrace<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  trace: IDagNodeExecutionTrace,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  const existing = getStateOrDefault(currentState, trace.nodeId, options);
  return {
    ...currentState,
    [trace.nodeId]: {
      ...existing,
      executionStatus: 'success',
      trace,
    },
  };
}

export function applyRunProgressEventToNodeStateMap<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  event: TRunProgressEvent,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  if (!isTaskProgressEvent(event)) {
    return currentState;
  }
  const existing = getStateOrDefault(currentState, event.nodeId, options);
  const nextTrace: IDagNodeExecutionTrace = {
    nodeId: event.nodeId,
    input: event.input ?? existing.trace?.input,
    output: event.output ?? existing.trace?.output,
  };
  return {
    ...currentState,
    [event.nodeId]: {
      ...existing,
      executionStatus: eventToExecutionStatus(event),
      trace: nextTrace,
    },
  };
}

export function applyRunResultToNodeStateMap<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  result: IRunResult,
  options?: INodeStateReducerOptions<TState>,
): Record<string, TState> {
  let nextState = currentState;
  for (const trace of result.traces) {
    const existing = getStateOrDefault(nextState, trace.nodeId, options);
    nextState = {
      ...nextState,
      [trace.nodeId]: {
        ...existing,
        executionStatus: 'success',
        trace: {
          nodeId: trace.nodeId,
          input: trace.input,
          output: trace.output,
        },
      },
    };
  }
  for (const nodeError of result.nodeErrors) {
    const existing = getStateOrDefault(nextState, nodeError.nodeId, options);
    nextState = {
      ...nextState,
      [nodeError.nodeId]: {
        ...existing,
        executionStatus: 'failed',
      },
    };
  }
  return nextState;
}

export function resetRunResultFromNode(
  definition: Pick<IDagDefinition, 'nodes'> & Partial<Pick<IDagDefinition, 'edges'>>,
  result: IRunResult,
  nodeId: string,
): IRunResult {
  const affectedNodeIds = collectNodeAndDownstreamIds(definition, nodeId);
  const traces = result.traces.filter((trace) => !affectedNodeIds.has(trace.nodeId));
  const nodeErrors = result.nodeErrors.filter(
    (nodeError) => !affectedNodeIds.has(nodeError.nodeId),
  );
  return {
    ...result,
    status: nodeErrors.length > 0 ? 'failed' : 'success',
    traces,
    nodeErrors,
    totalCredits: sumTraceCredits(traces),
  };
}

export function overwriteRunResultNodeTrace(result: IRunResult, trace: IRunNodeTrace): IRunResult {
  const traces = [
    ...result.traces.filter((existingTrace) => existingTrace.nodeId !== trace.nodeId),
    trace,
  ];
  const nodeErrors = result.nodeErrors.filter((nodeError) => nodeError.nodeId !== trace.nodeId);
  return {
    ...result,
    status: nodeErrors.length > 0 ? 'failed' : 'success',
    traces,
    nodeErrors,
    totalCredits: sumTraceCredits(traces),
  };
}

export function isDagNodeStateMapRunnable<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
): boolean {
  return Object.values(currentState).every(
    (state) => state.operationStatus === 'idle' && state.executionStatus !== 'running',
  );
}

function getStateOrDefault<TState extends IDagNodeState>(
  currentState: Record<string, TState>,
  nodeId: string,
  options?: INodeStateReducerOptions<TState>,
): TState {
  return (
    currentState[nodeId] ??
    options?.createState?.(nodeId) ??
    (createDefaultDagNodeState() as TState)
  );
}

function isTaskProgressEvent(
  event: TRunProgressEvent,
): event is Extract<TRunProgressEvent, { nodeId: string }> {
  return (
    event.eventType === TASK_PROGRESS_EVENTS.STARTED ||
    event.eventType === TASK_PROGRESS_EVENTS.COMPLETED ||
    event.eventType === TASK_PROGRESS_EVENTS.FAILED
  );
}

function eventToExecutionStatus(
  event: Extract<TRunProgressEvent, { nodeId: string }>,
): IDagNodeState['executionStatus'] {
  if (event.eventType === TASK_PROGRESS_EVENTS.STARTED) {
    return 'running';
  }
  if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED) {
    return 'success';
  }
  return 'failed';
}

function collectNodeAndDownstreamIds(
  definition: Pick<IDagDefinition, 'nodes'> & Partial<Pick<IDagDefinition, 'edges'>>,
  nodeId: string,
): Set<string> {
  const affectedNodeIds = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes) {
      if (affectedNodeIds.has(node.nodeId)) {
        continue;
      }
      const dependsOnAffectedNode = node.dependsOn.some((dependencyId) =>
        affectedNodeIds.has(dependencyId),
      );
      const hasIncomingAffectedEdge =
        definition.edges?.some(
          (edge) => edge.to === node.nodeId && affectedNodeIds.has(edge.from),
        ) ?? false;
      if (dependsOnAffectedNode || hasIncomingAffectedEdge) {
        affectedNodeIds.add(node.nodeId);
        changed = true;
      }
    }
  }
  return affectedNodeIds;
}

function sumTraceCredits(traces: IRunNodeTrace[]): number {
  return traces.reduce((total, trace) => total + trace.totalCredits, 0);
}
