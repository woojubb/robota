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
    type TRunProgressEvent,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import type { IDagNodeIoTrace } from './dag-node-view.js';
import { reconcileNodePortsAndEdges, summarizeRemovedBindings } from './port-editor-utils.js';
import type { IRunResult } from '../contracts/designer-api.js';
import {
    compactListBindings,
    computeBindingErrors,
    createNodeFromManifest,
    recomputeNodeDependencies
} from './canvas-utils.js';

export type TNodeExecutionStatus = 'idle' | 'running' | 'success' | 'failed';

interface INodeUiState {
    executionStatus: TNodeExecutionStatus;
    isSelected: boolean;
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

export interface IDagDesignerContextValue {
    definition: IDagDefinition;
    manifests: INodeManifest[];
    onDefinitionChange: (definition: IDagDefinition) => void;
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
    liveNodeTraceByNodeId: Record<string, IDagNodeIoTrace>;
    nodeUiStateByNodeId: Record<string, INodeUiState>;
    runProgress: IRunProgressState;
    setSelectedNodeId: (nodeId: string | undefined) => void;
    setSelectedEdgeId: (edgeId: string | undefined) => void;
    setConnectError: (error: string | undefined) => void;
    setRunResult: (result: IRunResult | undefined) => void;
    resetRunProgress: () => void;
    setActiveDagRunId: (dagRunId: string) => void;
    applyRunProgressEvent: (event: TRunProgressEvent) => void;
    bindingErrors: string[];
    addNodeFromManifest: (manifest: INodeManifest) => void;
    updateNode: (nextNode: IDagNode) => void;
    updateEdge: (nextEdge: IDagEdgeDefinition) => void;
    removeNodeById: (nodeId: string) => void;
    removeEdgeById: (edgeId: string) => void;
}

const DagDesignerContext = createContext<IDagDesignerContextValue | undefined>(undefined);

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

export function useDagDesignerContext(): IDagDesignerContextValue {
    const context = useContext(DagDesignerContext);
    if (!context) {
        throw new Error('DagDesigner components must be rendered under DagDesigner.Root');
    }
    return context;
}

export function DagDesignerRoot(props: IDagDesignerRootProps): ReactElement {
    const [selectedNodeId, setSelectedNodeIdState] = useState<string | undefined>(undefined);
    const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | undefined>(undefined);
    const [connectError, setConnectError] = useState<string | undefined>(undefined);
    const [bindingCleanupMessage, setBindingCleanupMessage] = useState<string | undefined>(undefined);
    const [runResult, setRunResult] = useState<IRunResult | undefined>(undefined);
    const [liveNodeTraceByNodeId, setLiveNodeTraceByNodeId] = useState<Record<string, IDagNodeIoTrace>>({});
    const [nodeUiStateByNodeId, setNodeUiStateByNodeId] = useState<Record<string, INodeUiState>>({});
    const [runProgress, setRunProgress] = useState<IRunProgressState>(INITIAL_RUN_PROGRESS_STATE);
    useEffect(() => {
        setNodeUiStateByNodeId((currentState) => {
            const nextState: Record<string, INodeUiState> = {};
            for (const node of props.definition.nodes) {
                const existingState = currentState[node.nodeId];
                nextState[node.nodeId] = {
                    executionStatus: existingState?.executionStatus ?? 'idle',
                    isSelected: existingState?.isSelected ?? false
                };
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
    const bindingErrors = useMemo(() => computeBindingErrors(props.definition), [props.definition]);

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
        setLiveNodeTraceByNodeId((currentTraceByNodeId) => {
            const nextTraceByNodeId: Record<string, IDagNodeIoTrace> = { ...currentTraceByNodeId };
            for (const trace of traces) {
                nextTraceByNodeId[trace.nodeId] = {
                    nodeId: trace.nodeId,
                    input: trace.input,
                    output: trace.output
                };
            }
            return nextTraceByNodeId;
        });
    }, [runResult]);

    const resetRunProgress = useCallback((): void => {
        clearPendingStatusTimers();
        nodeRunningSinceRef.current.clear();
        setRunProgress(INITIAL_RUN_PROGRESS_STATE);
    }, [clearPendingStatusTimers]);

    const setSelectedNodeId = useCallback((nodeId: string | undefined): void => {
        setSelectedNodeIdState(nodeId);
        setNodeUiStateByNodeId((currentState) => {
            const nextState: Record<string, INodeUiState> = {};
            for (const [currentNodeId, nodeState] of Object.entries(currentState)) {
                nextState[currentNodeId] = {
                    ...nodeState,
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
        setLiveNodeTraceByNodeId({});
        setNodeUiStateByNodeId((currentState) => {
            const nextState: Record<string, INodeUiState> = {};
            for (const node of props.definition.nodes) {
                const existingState = currentState[node.nodeId];
                nextState[node.nodeId] = {
                    executionStatus: 'idle',
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
    }, [clearPendingStatusTimers, props.definition.nodes]);

    const applyRunProgressEvent = useCallback((event: TRunProgressEvent): void => {
        if (
            event.eventType === TASK_PROGRESS_EVENTS.STARTED
            || event.eventType === TASK_PROGRESS_EVENTS.COMPLETED
            || event.eventType === TASK_PROGRESS_EVENTS.FAILED
        ) {
            const executionStatus = event.eventType === TASK_PROGRESS_EVENTS.STARTED
                ? 'running'
                : event.eventType === TASK_PROGRESS_EVENTS.COMPLETED
                    ? 'success'
                    : 'failed';
            setNodeUiStateByNodeId((currentState) => {
                const existingState = currentState[event.nodeId];
                return {
                    ...currentState,
                    [event.nodeId]: {
                        executionStatus,
                        isSelected: existingState?.isSelected ?? false
                    }
                };
            });
            setLiveNodeTraceByNodeId((currentTraceByNodeId) => {
                const currentTrace = currentTraceByNodeId[event.nodeId];
                const nextTrace: IDagNodeIoTrace = {
                    nodeId: event.nodeId,
                    input: event.input ?? currentTrace?.input,
                    output: event.output ?? currentTrace?.output
                };
                return {
                    ...currentTraceByNodeId,
                    [event.nodeId]: nextTrace
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
        const nextNode = createNodeFromManifest(manifest, props.definition.nodes.length);
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        props.onDefinitionChange({
            ...props.definition,
            nodes: [...props.definition.nodes, nextNode]
        });
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const updateNode = useCallback((nextNode: IDagNode): void => {
        const reconciled = reconcileNodePortsAndEdges(props.definition, nextNode);
        setBindingCleanupMessage(summarizeRemovedBindings(reconciled.removedBindings));
        resetRunProgress();
        props.onDefinitionChange(reconciled.nextDefinition);
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const updateEdge = useCallback((nextEdge: IDagEdgeDefinition): void => {
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        props.onDefinitionChange(compactListBindings({
            ...props.definition,
            edges: props.definition.edges.map((edge) => (
                edge.from === nextEdge.from && edge.to === nextEdge.to ? nextEdge : edge
            ))
        }));
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const removeEdgeById = useCallback((edgeId: string): void => {
        const nextEdges = props.definition.edges.filter((edge) => `${edge.from}->${edge.to}` !== edgeId);
        if (nextEdges.length === props.definition.edges.length) {
            return;
        }
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        setSelectedEdgeId(undefined);
        const nextNodes = recomputeNodeDependencies(props.definition.nodes, nextEdges);
        props.onDefinitionChange(compactListBindings({
            ...props.definition,
            nodes: nextNodes,
            edges: nextEdges
        }));
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const removeNodeById = useCallback((nodeId: string): void => {
        const nextNodes = props.definition.nodes.filter((node) => node.nodeId !== nodeId);
        if (nextNodes.length === props.definition.nodes.length) {
            return;
        }
        const nextEdges = props.definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
        const reconciledNodes = recomputeNodeDependencies(nextNodes, nextEdges);
        setBindingCleanupMessage(undefined);
        resetRunProgress();
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
        props.onDefinitionChange(compactListBindings({
            ...props.definition,
            nodes: reconciledNodes,
            edges: nextEdges
        }));
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const contextValue = useMemo<IDagDesignerContextValue>(() => ({
        definition: props.definition,
        manifests: props.manifests,
        onDefinitionChange: props.onDefinitionChange,
        assetUploadBaseUrl: props.assetUploadBaseUrl,
        onRunResult: props.onRunResult,
        onRun: props.onRun,
        initialInput: props.initialInput,
        selectedNodeId,
        selectedEdgeId,
        connectError,
        bindingCleanupMessage,
        runResult,
        liveNodeTraceByNodeId,
        nodeUiStateByNodeId,
        runProgress,
        setSelectedNodeId,
        setSelectedEdgeId,
        setConnectError,
        setRunResult,
        resetRunProgress,
        setActiveDagRunId,
        applyRunProgressEvent,
        bindingErrors,
        addNodeFromManifest,
        updateNode,
        updateEdge,
        removeNodeById,
        removeEdgeById
    }), [
        props.definition,
        props.manifests,
        props.onDefinitionChange,
        props.assetUploadBaseUrl,
        props.onRunResult,
        props.onRun,
        props.initialInput,
        selectedNodeId,
        selectedEdgeId,
        connectError,
        bindingCleanupMessage,
        runResult,
        liveNodeTraceByNodeId,
        nodeUiStateByNodeId,
        runProgress,
        bindingErrors,
        resetRunProgress,
        setActiveDagRunId,
        applyRunProgressEvent,
        addNodeFromManifest,
        updateNode,
        updateEdge,
        removeNodeById,
        removeEdgeById
    ]);

    return (
        <DagDesignerContext.Provider value={contextValue}>
            <div className={`robota-dag-root min-h-0 ${props.className ?? ''}`}>
                {props.children}
            </div>
        </DagDesignerContext.Provider>
    );
}
