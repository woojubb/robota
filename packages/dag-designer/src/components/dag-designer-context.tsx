import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  EXECUTION_PROGRESS_EVENTS,
  TASK_PROGRESS_EVENTS,
  applyRunProgressEventToNodeStateMap,
  applyRunResultToNodeStateMap,
  createDefaultDagNodeState,
  isDagNodeStateMapRunnable,
  markDagNodeOperationDone,
  markDagNodeOperationStarted,
  reconcileDagNodeStateMap,
  resetDagNodeExecutionStateMap,
  type IDagDefinition,
  type IDagEdgeDefinition,
  type IDagError,
  type IDagNode,
  type IDagNodeState,
  type INodeManifest,
  type INodeObjectInfo,
  type IRunResult,
  type TObjectInfo,
  type TRunProgressEvent,
  type TNodeExecutionStatus,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import type { IDagNodeIoTrace } from './dag-node-view.js';
import { reconcileNodePortsAndEdges, summarizeRemovedBindings } from './port-editor-utils.js';
import {
  compactListBindings,
  computeBindingErrors,
  createNodeFromManifest,
  createNodeFromObjectInfo,
  enrichDefinitionWithPorts,
  enrichNodeWithPorts,
  recomputeNodeDependencies,
  stripDefinitionNodePortDefinitions,
} from './canvas-utils.js';

export type { TNodeExecutionStatus, TNodeOperationStatus } from '@robota-sdk/dag-core';

export interface INodeState extends IDagNodeState {
  trace?: IDagNodeIoTrace;
  isSelected: boolean;
}

/** @deprecated Use INodeState instead */
export interface INodeUiState {
  executionStatus: TNodeExecutionStatus;
  isSelected: boolean;
}

function createDesignerNodeState(): INodeState {
  return {
    ...createDefaultDagNodeState(),
    isSelected: false,
  };
}

export interface IRunProgressState {
  activeDagRunId?: string;
  runStatus: 'idle' | 'running' | 'success' | 'failed';
  completedTaskCount: number;
  latestEventType?: TRunProgressEvent['eventType'];
}

export interface IRunProgressHooks {
  onRunStarted: (dagRunId: string) => void;
  onRunProgressEvent: (event: TRunProgressEvent) => void;
}

export interface IDagDesignerRootProps {
  definition: IDagDefinition;
  manifests: INodeManifest[];
  objectInfo?: TObjectInfo;
  onDefinitionChange: (definition: IDagDefinition) => void;
  assetUploadBaseUrl?: string;
  onRunResult?: (result: TResult<IRunResult, IDagError>) => void;
  onRun?: (
    input: {
      definition: IDagDefinition;
      input: TPortPayload;
    },
    hooks?: IRunProgressHooks,
  ) => Promise<TResult<IRunResult, IDagError>>;
  initialInput?: TPortPayload;
  children: ReactNode;
  className?: string;
}

interface IDagDesignerStateValue {
  definition: IDagDefinition;
  definitionWithRuntimePorts: IDagDefinition;
  manifests: INodeManifest[];
  objectInfo: TObjectInfo;
  assetUploadBaseUrl?: string;
  onRunResult?: (result: TResult<IRunResult, IDagError>) => void;
  onRun?: (
    input: {
      definition: IDagDefinition;
      input: TPortPayload;
    },
    hooks?: IRunProgressHooks,
  ) => Promise<TResult<IRunResult, IDagError>>;
  initialInput?: TPortPayload;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  connectError?: string;
  bindingCleanupMessage?: string;
  runResult?: IRunResult;
  nodeStateMap: Record<string, INodeState>;
  isRunnable: boolean;
  runProgress: IRunProgressState;
  bindingErrors: string[];
}

interface IDagDesignerActionsValue {
  onDefinitionChange: (definition: IDagDefinition) => void;
  setSelectedNodeId: (nodeId: string | undefined) => void;
  setSelectedEdgeId: (edgeId: string | undefined) => void;
  setConnectError: (error: string | undefined) => void;
  setRunResult: (result: IRunResult | undefined) => void;
  resetRunProgress: () => void;
  setActiveDagRunId: (dagRunId: string) => void;
  applyRunProgressEvent: (event: TRunProgressEvent) => void;
  addNodeFromManifest: (manifest: INodeManifest) => void;
  addNodeFromObjectInfo: (nodeType: string, info: INodeObjectInfo) => void;
  updateNode: (nextNode: IDagNode) => void;
  updateEdge: (nextEdge: IDagEdgeDefinition) => void;
  removeNodeById: (nodeId: string) => void;
  removeEdgeById: (edgeId: string) => void;
  setNodeUploading: (nodeId: string, description: string) => void;
  setNodeUploadDone: (nodeId: string) => void;
}

export interface IDagDesignerContextValue
  extends IDagDesignerStateValue,
    IDagDesignerActionsValue {}

const DagDesignerStateContext = createContext<IDagDesignerStateValue | undefined>(undefined);
const DagDesignerActionsContext = createContext<IDagDesignerActionsValue | undefined>(undefined);

const INITIAL_RUN_PROGRESS_STATE: IRunProgressState = {
  runStatus: 'idle',
  completedTaskCount: 0,
};
const MIN_RUNNING_DISPLAY_DURATION_MS = 400;

function applyRunProgressEventToState(
  currentState: IRunProgressState,
  event: TRunProgressEvent,
): IRunProgressState {
  if (event.eventType === TASK_PROGRESS_EVENTS.STARTED) {
    return {
      ...currentState,
      activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
      runStatus: 'running',
      latestEventType: event.eventType,
    };
  }
  if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED) {
    return {
      ...currentState,
      activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
      runStatus: currentState.runStatus === 'failed' ? 'failed' : 'running',
      completedTaskCount: currentState.completedTaskCount + 1,
      latestEventType: event.eventType,
    };
  }
  if (event.eventType === TASK_PROGRESS_EVENTS.FAILED) {
    return {
      ...currentState,
      activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
      runStatus: 'failed',
      latestEventType: event.eventType,
    };
  }
  if (event.eventType === EXECUTION_PROGRESS_EVENTS.STARTED) {
    return {
      ...currentState,
      activeDagRunId: event.dagRunId,
      runStatus: 'running',
      latestEventType: event.eventType,
    };
  }
  if (event.eventType === EXECUTION_PROGRESS_EVENTS.COMPLETED) {
    return {
      ...currentState,
      activeDagRunId: event.dagRunId,
      runStatus: 'success',
      latestEventType: event.eventType,
    };
  }
  return {
    ...currentState,
    activeDagRunId: event.dagRunId,
    runStatus: 'failed',
    latestEventType: event.eventType,
  };
}

/**
 * Returns both state and actions. Prefer useDagDesignerState() or useDagDesignerActions()
 * when you only need one — this hook re-renders on every state change.
 */
export function useDagDesignerContext(): IDagDesignerContextValue {
  const state = useContext(DagDesignerStateContext);
  const actions = useContext(DagDesignerActionsContext);
  if (!state || !actions) {
    throw new Error('DagDesigner components must be rendered under DagDesigner.Root');
  }
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

export function useDagDesignerState(): IDagDesignerStateValue {
  const state = useContext(DagDesignerStateContext);
  if (!state) {
    throw new Error('DagDesigner components must be rendered under DagDesigner.Root');
  }
  return state;
}

export function useDagDesignerActions(): IDagDesignerActionsValue {
  const actions = useContext(DagDesignerActionsContext);
  if (!actions) {
    throw new Error('DagDesigner components must be rendered under DagDesigner.Root');
  }
  return actions;
}

export function DagDesignerRoot(props: IDagDesignerRootProps): ReactElement {
  const definitionRef = useRef(props.definition);
  definitionRef.current = props.definition;

  const objectInfoRef = useRef(props.objectInfo);
  objectInfoRef.current = props.objectInfo;

  const onDefinitionChangeRef = useRef(props.onDefinitionChange);
  onDefinitionChangeRef.current = props.onDefinitionChange;

  const [selectedNodeId, setSelectedNodeIdState] = useState<string | undefined>(undefined);
  const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | undefined>(undefined);
  const [connectError, setConnectError] = useState<string | undefined>(undefined);
  const [bindingCleanupMessage, setBindingCleanupMessage] = useState<string | undefined>(undefined);
  const [runResult, setRunResult] = useState<IRunResult | undefined>(undefined);
  const [nodeStateMap, setNodeStateMap] = useState<Record<string, INodeState>>({});
  const [runProgress, setRunProgress] = useState<IRunProgressState>(INITIAL_RUN_PROGRESS_STATE);
  useEffect(() => {
    setNodeStateMap((currentState) => {
      return reconcileDagNodeStateMap({ nodes: props.definition.nodes }, currentState, {
        createState: createDesignerNodeState,
      });
    });
    setSelectedNodeIdState((currentNodeId) => {
      if (!currentNodeId) {
        return currentNodeId;
      }
      const isExistingNode = props.definition.nodes.some((node) => node.nodeId === currentNodeId);
      return isExistingNode ? currentNodeId : undefined;
    });
  }, [props.definition.nodes]);

  const nodeRunningSinceRef = useRef<Map<string, number>>(new Map());
  const pendingStatusTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const definitionWithRuntimePorts = useMemo<IDagDefinition>(
    () => enrichDefinitionWithPorts(props.definition, props.objectInfo, props.manifests),
    [props.definition, props.objectInfo, props.manifests],
  );
  const bindingErrors = useMemo(
    () => computeBindingErrors(definitionWithRuntimePorts),
    [definitionWithRuntimePorts],
  );

  const setNodeUploading = useCallback((nodeId: string, description: string): void => {
    setNodeStateMap((prev) =>
      markDagNodeOperationStarted(
        prev,
        nodeId,
        {
          status: 'uploading',
          description,
        },
        { createState: createDesignerNodeState },
      ),
    );
  }, []);

  const setNodeUploadDone = useCallback((nodeId: string): void => {
    setNodeStateMap((prev) =>
      markDagNodeOperationDone(prev, nodeId, { createState: createDesignerNodeState }),
    );
  }, []);

  const isRunnable = useMemo(() => isDagNodeStateMapRunnable(nodeStateMap), [nodeStateMap]);

  const clearPendingStatusTimers = useCallback((): void => {
    for (const timerId of pendingStatusTimersRef.current.values()) {
      clearTimeout(timerId);
    }
    pendingStatusTimersRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      clearPendingStatusTimers();
      nodeRunningSinceRef.current.clear();
    };
  }, [clearPendingStatusTimers]);

  useEffect(() => {
    if (!runResult) {
      return;
    }
    setNodeStateMap((currentState) => {
      return applyRunResultToNodeStateMap(currentState, runResult, {
        createState: createDesignerNodeState,
      });
    });
  }, [runResult]);

  const resetRunProgress = useCallback((): void => {
    clearPendingStatusTimers();
    nodeRunningSinceRef.current.clear();
    setRunProgress(INITIAL_RUN_PROGRESS_STATE);
  }, [clearPendingStatusTimers]);

  const setSelectedNodeId = useCallback((nodeId: string | undefined): void => {
    setSelectedNodeIdState(nodeId);
    setNodeStateMap((currentState) => {
      const nextState: Record<string, INodeState> = {};
      for (const [currentNodeId, state] of Object.entries(currentState)) {
        nextState[currentNodeId] = {
          ...state,
          isSelected: typeof nodeId === 'string' && currentNodeId === nodeId,
        };
      }
      return nextState;
    });
  }, []);

  const setSelectedEdgeId = useCallback((edgeId: string | undefined): void => {
    setSelectedEdgeIdState(edgeId);
  }, []);

  const setActiveDagRunId = useCallback(
    (dagRunId: string): void => {
      clearPendingStatusTimers();
      nodeRunningSinceRef.current.clear();
      setNodeStateMap((currentState) => {
        return resetDagNodeExecutionStateMap({ nodes: definitionRef.current.nodes }, currentState, {
          createState: createDesignerNodeState,
        });
      });
      setRunProgress({
        activeDagRunId: dagRunId,
        runStatus: 'running',
        completedTaskCount: 0,
      });
    },
    [clearPendingStatusTimers],
  );

  const applyRunProgressEvent = useCallback((event: TRunProgressEvent): void => {
    if (
      event.eventType === TASK_PROGRESS_EVENTS.STARTED ||
      event.eventType === TASK_PROGRESS_EVENTS.COMPLETED ||
      event.eventType === TASK_PROGRESS_EVENTS.FAILED
    ) {
      setNodeStateMap((currentState) => {
        return applyRunProgressEventToNodeStateMap(currentState, event, {
          createState: createDesignerNodeState,
        });
      });
    }
    setRunProgress((currentState) => {
      if (currentState.activeDagRunId && currentState.activeDagRunId !== event.dagRunId) {
        return currentState;
      }
      if (event.eventType === TASK_PROGRESS_EVENTS.STARTED) {
        nodeRunningSinceRef.current.set(event.nodeId, Date.now());
        const existingTimer = pendingStatusTimersRef.current.get(event.nodeId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          pendingStatusTimersRef.current.delete(event.nodeId);
        }
        return applyRunProgressEventToState(currentState, event);
      }
      if (
        event.eventType === TASK_PROGRESS_EVENTS.COMPLETED ||
        event.eventType === TASK_PROGRESS_EVENTS.FAILED
      ) {
        const runningSince = nodeRunningSinceRef.current.get(event.nodeId);
        const elapsedMs =
          typeof runningSince === 'number'
            ? Date.now() - runningSince
            : MIN_RUNNING_DISPLAY_DURATION_MS;
        const remainingMs = Math.max(0, MIN_RUNNING_DISPLAY_DURATION_MS - elapsedMs);
        if (remainingMs > 0) {
          const existingTimer = pendingStatusTimersRef.current.get(event.nodeId);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          const timerId = setTimeout(() => {
            pendingStatusTimersRef.current.delete(event.nodeId);
            nodeRunningSinceRef.current.delete(event.nodeId);
            setRunProgress((stateAtTimer) => {
              if (stateAtTimer.activeDagRunId && stateAtTimer.activeDagRunId !== event.dagRunId) {
                return stateAtTimer;
              }
              return applyRunProgressEventToState(stateAtTimer, event);
            });
          }, remainingMs);
          pendingStatusTimersRef.current.set(event.nodeId, timerId);
          return currentState;
        }
        nodeRunningSinceRef.current.delete(event.nodeId);
        pendingStatusTimersRef.current.delete(event.nodeId);
      }
      return applyRunProgressEventToState(currentState, event);
    });
  }, []);

  const addNodeFromManifest = useCallback(
    (manifest: INodeManifest): void => {
      const def = definitionRef.current;
      const nextNode = createNodeFromManifest(manifest, def.nodes.length);
      setBindingCleanupMessage(undefined);
      resetRunProgress();
      onDefinitionChangeRef.current({
        ...def,
        nodes: [...def.nodes, nextNode],
      });
    },
    [resetRunProgress],
  );

  const addNodeFromObjectInfo = useCallback(
    (nodeType: string, info: INodeObjectInfo): void => {
      const def = definitionRef.current;
      const nextNode = createNodeFromObjectInfo(nodeType, info, def.nodes.length);
      setBindingCleanupMessage(undefined);
      resetRunProgress();
      onDefinitionChangeRef.current({
        ...def,
        nodes: [...def.nodes, nextNode],
      });
    },
    [resetRunProgress],
  );

  const updateNode = useCallback(
    (nextNode: IDagNode): void => {
      const def = definitionRef.current;
      const enrichedDef = enrichDefinitionWithPorts(def, objectInfoRef.current, props.manifests);
      const enrichedNextNode = enrichNodeWithPorts(
        nextNode,
        objectInfoRef.current,
        props.manifests,
      );
      const reconciled = reconcileNodePortsAndEdges(enrichedDef, enrichedNextNode);
      setBindingCleanupMessage(summarizeRemovedBindings(reconciled.removedBindings));
      resetRunProgress();
      onDefinitionChangeRef.current(stripDefinitionNodePortDefinitions(reconciled.nextDefinition));
    },
    [props.manifests, resetRunProgress],
  );

  const updateEdge = useCallback(
    (nextEdge: IDagEdgeDefinition): void => {
      const def = definitionRef.current;
      const enrichedDefinition = enrichDefinitionWithPorts(
        def,
        objectInfoRef.current,
        props.manifests,
      );
      setBindingCleanupMessage(undefined);
      resetRunProgress();
      const compacted = compactListBindings({
        ...enrichedDefinition,
        edges: def.edges.map((edge) =>
          edge.from === nextEdge.from && edge.to === nextEdge.to ? nextEdge : edge,
        ),
      });
      onDefinitionChangeRef.current(
        stripDefinitionNodePortDefinitions({
          ...def,
          edges: compacted.edges,
        }),
      );
    },
    [props.manifests, resetRunProgress],
  );

  const removeEdgeById = useCallback(
    (edgeId: string): void => {
      const def = definitionRef.current;
      const nextEdges = def.edges.filter((edge) => `${edge.from}->${edge.to}` !== edgeId);
      if (nextEdges.length === def.edges.length) {
        return;
      }
      setBindingCleanupMessage(undefined);
      resetRunProgress();
      setSelectedEdgeId(undefined);
      const nextNodes = recomputeNodeDependencies(def.nodes, nextEdges);
      const enrichedDefinition = enrichDefinitionWithPorts(
        { ...def, nodes: nextNodes, edges: nextEdges },
        objectInfoRef.current,
        props.manifests,
      );
      const compacted = compactListBindings(enrichedDefinition);
      onDefinitionChangeRef.current(
        stripDefinitionNodePortDefinitions({
          ...def,
          nodes: nextNodes,
          edges: compacted.edges,
        }),
      );
    },
    [props.manifests, resetRunProgress],
  );

  const removeNodeById = useCallback(
    (nodeId: string): void => {
      const def = definitionRef.current;
      const nextNodes = def.nodes.filter((node) => node.nodeId !== nodeId);
      if (nextNodes.length === def.nodes.length) {
        return;
      }
      const nextEdges = def.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
      const reconciledNodes = recomputeNodeDependencies(nextNodes, nextEdges);
      const enrichedDefinition = enrichDefinitionWithPorts(
        { ...def, nodes: reconciledNodes, edges: nextEdges },
        objectInfoRef.current,
        props.manifests,
      );
      const compacted = compactListBindings(enrichedDefinition);
      setBindingCleanupMessage(undefined);
      resetRunProgress();
      setSelectedNodeId(undefined);
      setSelectedEdgeId(undefined);
      onDefinitionChangeRef.current(
        stripDefinitionNodePortDefinitions({
          ...def,
          nodes: reconciledNodes,
          edges: compacted.edges,
        }),
      );
    },
    [props.manifests, resetRunProgress],
  );

  const stateValue = useMemo<IDagDesignerStateValue>(
    () => ({
      definition: props.definition,
      definitionWithRuntimePorts,
      manifests: props.manifests,
      objectInfo: props.objectInfo ?? {},
      assetUploadBaseUrl: props.assetUploadBaseUrl,
      onRunResult: props.onRunResult,
      onRun: props.onRun,
      initialInput: props.initialInput,
      selectedNodeId,
      selectedEdgeId,
      connectError,
      bindingCleanupMessage,
      runResult,
      nodeStateMap,
      isRunnable,
      runProgress,
      bindingErrors,
    }),
    [
      props.definition,
      definitionWithRuntimePorts,
      props.manifests,
      props.objectInfo,
      props.assetUploadBaseUrl,
      props.onRunResult,
      props.onRun,
      props.initialInput,
      selectedNodeId,
      selectedEdgeId,
      connectError,
      bindingCleanupMessage,
      runResult,
      nodeStateMap,
      isRunnable,
      runProgress,
      bindingErrors,
    ],
  );

  const actionsValue = useMemo<IDagDesignerActionsValue>(
    () => ({
      onDefinitionChange: props.onDefinitionChange,
      setSelectedNodeId,
      setSelectedEdgeId,
      setConnectError,
      setRunResult,
      resetRunProgress,
      setActiveDagRunId,
      applyRunProgressEvent,
      addNodeFromManifest,
      addNodeFromObjectInfo,
      updateNode,
      updateEdge,
      removeNodeById,
      removeEdgeById,
      setNodeUploading,
      setNodeUploadDone,
    }),
    [
      props.onDefinitionChange,
      resetRunProgress,
      setActiveDagRunId,
      applyRunProgressEvent,
      addNodeFromManifest,
      addNodeFromObjectInfo,
      updateNode,
      updateEdge,
      removeNodeById,
      removeEdgeById,
      setNodeUploading,
      setNodeUploadDone,
    ],
  );

  return (
    <DagDesignerStateContext.Provider value={stateValue}>
      <DagDesignerActionsContext.Provider value={actionsValue}>
        <div className={`robota-dag-root min-h-0 ${props.className ?? ''}`}>{props.children}</div>
      </DagDesignerActionsContext.Provider>
    </DagDesignerStateContext.Provider>
  );
}
