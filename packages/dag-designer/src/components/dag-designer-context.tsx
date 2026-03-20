import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type ReactNode
} from 'react';
import {
    EXECUTION_PROGRESS_EVENTS,
    TASK_PROGRESS_EVENTS,
    type IDagDefinition,
    type IDagEdgeDefinition,
    type IDagError,
    type IDagNode,
    type INodeManifest,
    type INodeObjectInfo,
    type IRunResult,
    type TObjectInfo,
    type TRunProgressEvent,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import type { IDagNodeIoTrace } from './dag-node-view.js';
import { reconcileNodePortsAndEdges, summarizeRemovedBindings } from './port-editor-utils.js';
import {
    compactListBindings,
    computeBindingErrors,
    createNodeFromManifest,
    createNodeFromObjectInfo,
    enrichNodeWithPorts,
    recomputeNodeDependencies
} from './canvas-utils.js';

export type TNodeExecutionStatus = 'idle' | 'running' | 'success' | 'failed';

export type TNodeOperationStatus = 'idle' | 'uploading' | 'running' | 'success' | 'failed';

export interface INodeState {
    operationStatus: TNodeOperationStatus;
    pendingDescription?: string;
    trace?: IDagNodeIoTrace;
    isSelected: boolean;
}

/** @deprecated Use INodeState instead */
export interface INodeUiState {
    executionStatus: TNodeExecutionStatus;
    isSelected: boolean;
}

const DEFAULT_NODE_STATE: INodeState = { operationStatus: 'idle', isSelected: false };

function getNodeStateOrDefault(map: Record<string, INodeState>, nodeId: string): INodeState {
    return map[nodeId] ?? DEFAULT_NODE_STATE;
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
    onRun?: (input: {
        definition: IDagDefinition;
        input: TPortPayload;
    }, hooks?: IRunProgressHooks) => Promise<TResult<IRunResult, IDagError>>;
    initialInput?: TPortPayload;
    children: ReactNode;
    className?: string;
}

interface IDagDesignerStateValue {
    definition: IDagDefinition;
    manifests: INodeManifest[];
    objectInfo: TObjectInfo;
    assetUploadBaseUrl?: string;
    onRunResult?: (result: TResult<IRunResult, IDagError>) => void;
    onRun?: (input: {
        definition: IDagDefinition;
        input: TPortPayload;
    }, hooks?: IRunProgressHooks) => Promise<TResult<IRunResult, IDagError>>;
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

export interface IDagDesignerContextValue extends IDagDesignerStateValue, IDagDesignerActionsValue {}

const DagDesignerStateContext = createContext<IDagDesignerStateValue | undefined>(undefined);
const DagDesignerActionsContext = createContext<IDagDesignerActionsValue | undefined>(undefined);

const INITIAL_RUN_PROGRESS_STATE: IRunProgressState = {
    runStatus: 'idle',
    completedTaskCount: 0
};
const MIN_RUNNING_DISPLAY_DURATION_MS = 400;

function applyRunProgressEventToState(
    currentState: IRunProgressState,
    event: TRunProgressEvent
): IRunProgressState {
    if (event.eventType === TASK_PROGRESS_EVENTS.STARTED) {
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: 'running',
            latestEventType: event.eventType
        };
    }
    if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED) {
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: currentState.runStatus === 'failed' ? 'failed' : 'running',
            completedTaskCount: currentState.completedTaskCount + 1,
            latestEventType: event.eventType
        };
    }
    if (event.eventType === TASK_PROGRESS_EVENTS.FAILED) {
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: 'failed',
            latestEventType: event.eventType
        };
    }
    if (event.eventType === EXECUTION_PROGRESS_EVENTS.STARTED) {
        return {
            ...currentState,
            activeDagRunId: event.dagRunId,
            runStatus: 'running',
            latestEventType: event.eventType
        };
    }
    if (event.eventType === EXECUTION_PROGRESS_EVENTS.COMPLETED) {
        return {
            ...currentState,
            activeDagRunId: event.dagRunId,
            runStatus: 'success',
            latestEventType: event.eventType
        };
    }
    return {
        ...currentState,
        activeDagRunId: event.dagRunId,
        runStatus: 'failed',
        latestEventType: event.eventType
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
            const nextState: Record<string, INodeState> = {};
            for (const node of props.definition.nodes) {
                const existingState = currentState[node.nodeId];
                nextState[node.nodeId] = existingState ?? DEFAULT_NODE_STATE;
            }
            return nextState;
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
    const enrichedDefinition = useMemo<IDagDefinition>(() => {
        const enrichedNodes = props.definition.nodes.map((node) => enrichNodeWithPorts(node, props.objectInfo));
        return { ...props.definition, nodes: enrichedNodes };
    }, [props.definition, props.objectInfo]);
    const bindingErrors = useMemo(() => computeBindingErrors(enrichedDefinition), [enrichedDefinition]);

    const setNodeUploading = useCallback((nodeId: string, description: string): void => {
        setNodeStateMap(prev => ({
            ...prev,
            [nodeId]: { ...getNodeStateOrDefault(prev, nodeId), operationStatus: 'uploading', pendingDescription: description }
        }));
    }, []);

    const setNodeUploadDone = useCallback((nodeId: string): void => {
        setNodeStateMap(prev => ({
            ...prev,
            [nodeId]: { ...getNodeStateOrDefault(prev, nodeId), operationStatus: 'idle', pendingDescription: undefined }
        }));
    }, []);

    const isRunnable = useMemo(
        () => Object.values(nodeStateMap).every(s => s.operationStatus !== 'uploading'),
        [nodeStateMap]
    );

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
        const traces = runResult?.traces ?? [];
        if (traces.length === 0) {
            return;
        }
        setNodeStateMap((currentState) => {
            const nextState: Record<string, INodeState> = { ...currentState };
            for (const trace of traces) {
                const existing = getNodeStateOrDefault(nextState, trace.nodeId);
                nextState[trace.nodeId] = {
                    ...existing,
                    trace: {
                        nodeId: trace.nodeId,
                        input: trace.input,
                        output: trace.output
                    }
                };
            }
            return nextState;
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
                    isSelected: typeof nodeId === 'string' && currentNodeId === nodeId
                };
            }
            return nextState;
        });
    }, []);

    const setSelectedEdgeId = useCallback((edgeId: string | undefined): void => {
        setSelectedEdgeIdState(edgeId);
    }, []);

    const setActiveDagRunId = useCallback((dagRunId: string): void => {
        clearPendingStatusTimers();
        nodeRunningSinceRef.current.clear();
        setNodeStateMap((currentState) => {
            const nextState: Record<string, INodeState> = {};
            for (const node of definitionRef.current.nodes) {
                const existingState = currentState[node.nodeId];
                nextState[node.nodeId] = {
                    operationStatus: 'idle',
                    isSelected: existingState?.isSelected ?? false
                };
            }
            return nextState;
        });
        setRunProgress({
            activeDagRunId: dagRunId,
            runStatus: 'running',
            completedTaskCount: 0
        });
    }, [clearPendingStatusTimers]);

    const applyRunProgressEvent = useCallback((event: TRunProgressEvent): void => {
        if (
            event.eventType === TASK_PROGRESS_EVENTS.STARTED
            || event.eventType === TASK_PROGRESS_EVENTS.COMPLETED
            || event.eventType === TASK_PROGRESS_EVENTS.FAILED
        ) {
            const operationStatus: TNodeOperationStatus = event.eventType === TASK_PROGRESS_EVENTS.STARTED
                ? 'running'
                : event.eventType === TASK_PROGRESS_EVENTS.COMPLETED
                    ? 'success'
                    : 'failed';
            setNodeStateMap((currentState) => {
                const existing = getNodeStateOrDefault(currentState, event.nodeId);
                const currentTrace = existing.trace;
                const nextTrace: IDagNodeIoTrace = {
                    nodeId: event.nodeId,
                    input: event.input ?? currentTrace?.input,
                    output: event.output ?? currentTrace?.output
                };
                return {
                    ...currentState,
                    [event.nodeId]: {
                        ...existing,
                        operationStatus,
                        trace: nextTrace
                    }
                };
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
            if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED || event.eventType === TASK_PROGRESS_EVENTS.FAILED) {
                const runningSince = nodeRunningSinceRef.current.get(event.nodeId);
                const elapsedMs = typeof runningSince === 'number' ? Date.now() - runningSince : MIN_RUNNING_DISPLAY_DURATION_MS;
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

    const addNodeFromManifest = useCallback((manifest: INodeManifest): void => {
        const def = definitionRef.current;
        const nextNode = createNodeFromManifest(manifest, def.nodes.length);
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        onDefinitionChangeRef.current({
            ...def,
            nodes: [...def.nodes, nextNode]
        });
    }, [resetRunProgress]);

    const addNodeFromObjectInfo = useCallback((nodeType: string, info: INodeObjectInfo): void => {
        const def = definitionRef.current;
        const nextNode = createNodeFromObjectInfo(nodeType, info, def.nodes.length);
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        onDefinitionChangeRef.current({
            ...def,
            nodes: [...def.nodes, nextNode]
        });
    }, [resetRunProgress]);

    const updateNode = useCallback((nextNode: IDagNode): void => {
        const def = definitionRef.current;
        const enrichedDef = {
            ...def,
            nodes: def.nodes.map((node) => enrichNodeWithPorts(node, objectInfoRef.current))
        };
        const reconciled = reconcileNodePortsAndEdges(enrichedDef, nextNode);
        setBindingCleanupMessage(summarizeRemovedBindings(reconciled.removedBindings));
        resetRunProgress();
        onDefinitionChangeRef.current(reconciled.nextDefinition);
    }, [resetRunProgress]);

    const updateEdge = useCallback((nextEdge: IDagEdgeDefinition): void => {
        const def = definitionRef.current;
        const enrichedNodes = def.nodes.map((node) => enrichNodeWithPorts(node, objectInfoRef.current));
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        onDefinitionChangeRef.current(compactListBindings({
            ...def,
            nodes: enrichedNodes,
            edges: def.edges.map((edge) => (
                edge.from === nextEdge.from && edge.to === nextEdge.to ? nextEdge : edge
            ))
        }));
    }, [resetRunProgress]);

    const removeEdgeById = useCallback((edgeId: string): void => {
        const def = definitionRef.current;
        const nextEdges = def.edges.filter((edge) => `${edge.from}->${edge.to}` !== edgeId);
        if (nextEdges.length === def.edges.length) {
            return;
        }
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        setSelectedEdgeId(undefined);
        const enrichedNodes = def.nodes.map((node) => enrichNodeWithPorts(node, objectInfoRef.current));
        const nextNodes = recomputeNodeDependencies(enrichedNodes, nextEdges);
        onDefinitionChangeRef.current(compactListBindings({
            ...def,
            nodes: nextNodes,
            edges: nextEdges
        }));
    }, [resetRunProgress]);

    const removeNodeById = useCallback((nodeId: string): void => {
        const def = definitionRef.current;
        const nextNodes = def.nodes.filter((node) => node.nodeId !== nodeId);
        if (nextNodes.length === def.nodes.length) {
            return;
        }
        const nextEdges = def.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
        const enrichedNodes = nextNodes.map((node) => enrichNodeWithPorts(node, objectInfoRef.current));
        const reconciledNodes = recomputeNodeDependencies(enrichedNodes, nextEdges);
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
        onDefinitionChangeRef.current(compactListBindings({
            ...def,
            nodes: reconciledNodes,
            edges: nextEdges
        }));
    }, [resetRunProgress]);

    const stateValue = useMemo<IDagDesignerStateValue>(() => ({
        definition: props.definition,
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
    }), [
        props.definition,
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
    ]);

    const actionsValue = useMemo<IDagDesignerActionsValue>(() => ({
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
    }), [
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
    ]);

    return (
        <DagDesignerStateContext.Provider value={stateValue}>
            <DagDesignerActionsContext.Provider value={actionsValue}>
                <div className={`robota-dag-root min-h-0 ${props.className ?? ''}`}>
                    {props.children}
                </div>
            </DagDesignerActionsContext.Provider>
        </DagDesignerStateContext.Provider>
    );
}
