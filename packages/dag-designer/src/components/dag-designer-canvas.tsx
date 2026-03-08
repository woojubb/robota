// TODO: This file exceeds 300 lines. Candidates for extraction:
// - DagDesignerContext and provider logic into a dedicated context module
// - Edge validation helpers (validateEdgeBindings, compactListBindings) into edge-utils
// - Connection handling callbacks (onConnect, onEdgesChange) into connection-handlers
// - Node creation and manifest helpers into node-factory utils
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
    Background,
    type Connection,
    ConnectionMode,
    ConnectionLineType,
    Controls,
    type Edge,
    type EdgeTypes,
    type EdgeMouseHandler,
    type Node,
    type NodeTypes,
    type NodeMouseHandler,
    type XYPosition,
    ReactFlow,
    useEdgesState,
    useNodesState
} from '@xyflow/react';
import {
    buildListPortHandleKey,
    parseListPortHandleKey,
    EXECUTION_PROGRESS_EVENTS,
    TASK_PROGRESS_EVENTS,
    type IDagDefinition,
    type IDagEdgeDefinition,
    type IDagError,
    type IDagNode,
    type INodeManifest,
    type IPortDefinition,
    type TRunProgressEvent,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { EdgeInspectorPanel } from './edge-inspector-panel.js';
import { DagBindingEdge, type IDagBindingEdgeData } from './dag-binding-edge.js';
import {
    DagNodeView,
    type IDagNodeIoTrace,
    type IDagNodeViewData,
    type TDagCanvasNode
} from './dag-node-view.js';
import { NodeConfigPanel } from './node-config-panel.js';
import { NodeIoTracePanel } from './node-io-trace-panel.js';
import { NodeExplorerPanel } from './node-explorer-panel.js';
import { findPort, resolveInputPort, reconcileNodePortsAndEdges, summarizeRemovedBindings } from './port-editor-utils.js';
import type { IRunResult } from '../contracts/designer-api.js';
import '@xyflow/react/dist/style.css';

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

function toNode(
    nodeDefinition: IDagNode,
    index: number,
    nodeUiState: INodeUiState | undefined,
    latestTrace?: IDagNodeIoTrace,
    assetBaseUrl?: string,
    positionOverride?: XYPosition,
    inputHandlesByPortKey?: Record<string, string[]>
): TDagCanvasNode {
    const traceSignature = latestTrace
        ? JSON.stringify({
            nodeId: latestTrace.nodeId,
            input: latestTrace.input,
            output: latestTrace.output
        })
        : undefined;
    return {
        id: nodeDefinition.nodeId,
        type: 'dag-node',
        dragHandle: '.dag-node-drag-handle',
        data: {
            label: nodeDefinition.nodeId,
            nodeType: nodeDefinition.nodeType,
            inputs: nodeDefinition.inputs,
            outputs: nodeDefinition.outputs,
            executionStatus: nodeUiState?.executionStatus ?? 'idle',
            isSelected: nodeUiState?.isSelected ?? false,
            latestTrace,
            assetBaseUrl,
            traceSignature,
            inputHandlesByPortKey
        } satisfies IDagNodeViewData,
        position: positionOverride
            ?? nodeDefinition.position
            ?? { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 }
    };
}

function formatBindingLabel(edgeDefinition: IDagEdgeDefinition): string {
    const bindings = edgeDefinition.bindings ?? [];
    if (bindings.length === 0) {
        return 'no-binding';
    }
    const rendered = bindings
        .slice(0, 2)
        .map((binding) => `${binding.outputKey} -> ${binding.inputKey}`);
    if (bindings.length > 2) {
        rendered.push(`+${bindings.length - 2} more`);
    }
    return rendered.join(', ');
}

function formatBindingFullLabel(edgeDefinition: IDagEdgeDefinition): string {
    const bindings = edgeDefinition.bindings ?? [];
    if (bindings.length === 0) {
        return 'no-binding';
    }
    return bindings.map((binding) => `${binding.outputKey} -> ${binding.inputKey}`).join('\n');
}

function toEdge(
    edgeDefinition: IDagEdgeDefinition,
    onSelectEdge: (edgeId: string) => void
): Edge {
    const firstBinding = edgeDefinition.bindings?.[0];
    const hasBinding = Boolean(firstBinding);
    return {
        id: `${edgeDefinition.from}->${edgeDefinition.to}`,
        type: 'binding-edge',
        source: edgeDefinition.from,
        target: edgeDefinition.to,
        sourceHandle: firstBinding?.outputKey,
        targetHandle: firstBinding?.inputKey,
        data: {
            shortLabel: formatBindingLabel(edgeDefinition),
            fullLabel: formatBindingFullLabel(edgeDefinition),
            hasBinding,
            onSelectEdge
        } satisfies IDagBindingEdgeData
    };
}

function hasSameCanvasNodeState(currentNodes: Node[], nextNodes: Node[]): boolean {
    if (currentNodes.length !== nextNodes.length) {
        return false;
    }
    return currentNodes.every((currentNode, index) => {
        const nextNode = nextNodes[index];
        const currentExecutionStatus = (currentNode.data as { executionStatus?: TNodeExecutionStatus } | undefined)?.executionStatus ?? 'idle';
        const nextExecutionStatus = (nextNode.data as { executionStatus?: TNodeExecutionStatus } | undefined)?.executionStatus ?? 'idle';
        const currentSelected = (currentNode.data as { isSelected?: boolean } | undefined)?.isSelected ?? false;
        const nextSelected = (nextNode.data as { isSelected?: boolean } | undefined)?.isSelected ?? false;
        const currentTraceSignature = (currentNode.data as { traceSignature?: string } | undefined)?.traceSignature;
        const nextTraceSignature = (nextNode.data as { traceSignature?: string } | undefined)?.traceSignature;
        return (
            currentNode.id === nextNode.id &&
            currentNode.position.x === nextNode.position.x &&
            currentNode.position.y === nextNode.position.y &&
            currentExecutionStatus === nextExecutionStatus &&
            currentSelected === nextSelected &&
            currentTraceSignature === nextTraceSignature
        );
    });
}

function hasSameCanvasEdgeState(currentEdges: Edge[], nextEdges: Edge[]): boolean {
    if (currentEdges.length !== nextEdges.length) {
        return false;
    }
    return currentEdges.every((currentEdge, index) => {
        const nextEdge = nextEdges[index];
        return (
            currentEdge.id === nextEdge.id &&
            currentEdge.source === nextEdge.source &&
            currentEdge.target === nextEdge.target
        );
    });
}

function createNodeFromManifest(manifest: INodeManifest, index: number): IDagNode {
    return {
        nodeId: `${manifest.nodeType}_${index + 1}`,
        nodeType: manifest.nodeType,
        position: { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 },
        dependsOn: [],
        config: {},
        inputs: manifest.inputs,
        outputs: manifest.outputs
    };
}

function compactListBindings(definition: IDagDefinition): IDagDefinition {
    const nextEdges = definition.edges.map((edge) => {
        if (!edge.bindings || edge.bindings.length === 0) {
            return edge;
        }
        const targetNode = definition.nodes.find((node) => node.nodeId === edge.to);
        if (!targetNode) {
            return edge;
        }
        const listInputPorts = targetNode.inputs.filter((port) => port.isList);
        if (listInputPorts.length === 0) {
            return edge;
        }
        const bindingIndexByListKey = new Map<string, number>();
        const nextBindings = edge.bindings.map((binding) => {
            const listHandle = parseListPortHandleKey(binding.inputKey);
            const directListPort = targetNode.inputs.find((port) => port.key === binding.inputKey && port.isList);
            const listPortKey = directListPort
                ? directListPort.key
                : listHandle?.portKey;
            if (!listPortKey) {
                return binding;
            }
            const listPort = targetNode.inputs.find((port) => port.key === listPortKey && port.isList);
            if (!listPort) {
                return binding;
            }
            const nextIndex = bindingIndexByListKey.get(listPortKey) ?? 0;
            bindingIndexByListKey.set(listPortKey, nextIndex + 1);
            return {
                ...binding,
                inputKey: buildListPortHandleKey(listPortKey, nextIndex)
            };
        });
        return {
            ...edge,
            bindings: nextBindings
        };
    });
    return {
        ...definition,
        edges: nextEdges
    };
}

function computeInputHandlesByPortKey(
    definition: IDagDefinition,
    nodeId: string,
    inputPorts: IPortDefinition[]
): Record<string, string[]> {
    const handlesByPortKey: Record<string, string[]> = {};
    const incomingEdges = definition.edges.filter((edge) => edge.to === nodeId);
    for (const inputPort of inputPorts) {
        if (!inputPort.isList) {
            continue;
        }
        const slotIndices: number[] = [];
        for (const edge of incomingEdges) {
            for (const binding of edge.bindings ?? []) {
                if (binding.inputKey === inputPort.key) {
                    slotIndices.push(0);
                    continue;
                }
                const listHandle = parseListPortHandleKey(binding.inputKey);
                if (!listHandle || listHandle.portKey !== inputPort.key) {
                    continue;
                }
                slotIndices.push(listHandle.index);
            }
        }
        const connectedCount = slotIndices.length;
        const handleIds: string[] = [];
        for (let index = 0; index < connectedCount + 1; index += 1) {
            handleIds.push(buildListPortHandleKey(inputPort.key, index));
        }
        handlesByPortKey[inputPort.key] = handleIds;
    }
    return handlesByPortKey;
}

function computeBindingErrors(definition: IDagDefinition): string[] {
    const errors: string[] = [];
    const usedInputKeysByTarget = new Map<string, Set<string>>();
    for (const edge of definition.edges) {
        const fromNode = definition.nodes.find((node) => node.nodeId === edge.from);
        const toNode = definition.nodes.find((node) => node.nodeId === edge.to);
        if (!fromNode || !toNode) {
            errors.push(`Edge ${edge.from}->${edge.to}: source or target node is missing.`);
            continue;
        }
        if (!edge.bindings || edge.bindings.length === 0) {
            errors.push(`Edge ${edge.from}->${edge.to}: bindings are empty.`);
            continue;
        }

        const usedInEdge = new Set<string>();
        for (const binding of edge.bindings) {
            const outputPort = findPort(fromNode.outputs, binding.outputKey);
            if (!outputPort) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: output key "${binding.outputKey}" was removed or not found.`
                );
            }
            const resolvedInput = resolveInputPort(toNode.inputs, binding.inputKey);
            const inputPort = resolvedInput.port;
            if (!inputPort) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: input key "${binding.inputKey}" was removed or not found.`
                );
                continue;
            }
            if (outputPort && inputPort && outputPort.type !== inputPort.type) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: type mismatch "${binding.outputKey}"(${outputPort.type}) -> "${binding.inputKey}"(${inputPort.type}).`
                );
            }
            const inputIdentity = inputPort.isList ? binding.inputKey : resolvedInput.resolvedKey;
            if (usedInEdge.has(inputIdentity)) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: duplicate input key "${binding.inputKey}" in same edge.`
                );
            } else {
                usedInEdge.add(inputIdentity);
            }

            const usedByTarget = usedInputKeysByTarget.get(edge.to) ?? new Set<string>();
            if (usedByTarget.has(inputIdentity)) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: input key "${binding.inputKey}" conflicts with another upstream edge.`
                );
            } else {
                usedByTarget.add(inputIdentity);
                usedInputKeysByTarget.set(edge.to, usedByTarget);
            }
        }
    }
    return errors;
}

function recomputeNodeDependencies(
    nodes: IDagDefinition['nodes'],
    edges: IDagDefinition['edges']
): IDagDefinition['nodes'] {
    const upstreamNodeIdsByTarget = new Map<string, Set<string>>();
    for (const edge of edges) {
        const upstreamNodeIds = upstreamNodeIdsByTarget.get(edge.to) ?? new Set<string>();
        upstreamNodeIds.add(edge.from);
        upstreamNodeIdsByTarget.set(edge.to, upstreamNodeIds);
    }
    return nodes.map((node) => ({
        ...node,
        dependsOn: [...(upstreamNodeIdsByTarget.get(node.nodeId) ?? new Set<string>())]
    }));
}

export interface IDagDesignerCanvasProps {
    className?: string;
}

export interface IDagDesignerNodeExplorerProps {
    className?: string;
}

export interface IDagDesignerInspectorProps {
    className?: string;
}

export interface IDagDesignerNodeConfigProps {
    className?: string;
}

export interface IDagDesignerEdgeInspectorProps {
    className?: string;
}

export interface IDagDesignerNodeIoTraceProps {
    className?: string;
}

export interface IDagDesignerRunProgressSummaryProps {
    className?: string;
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

export function DagDesignerCanvas(props: IDagDesignerCanvasProps): ReactElement {
    const context = useDagDesignerContext();
    const isSyncingEdgesFromDefinitionRef = useRef<boolean>(false);
    const nodeTypes = useMemo<NodeTypes>(() => ({ 'dag-node': DagNodeView }), []);
    const edgeTypes = useMemo<EdgeTypes>(() => ({ 'binding-edge': DagBindingEdge }), []);

    const selectEdgeById = useCallback((edgeId: string): void => {
        context.setSelectedEdgeId(edgeId);
        context.setSelectedNodeId(undefined);
    }, [context.setSelectedEdgeId, context.setSelectedNodeId]);

    const latestTraceByNodeId = useMemo(() => {
        const map = new Map<string, IDagNodeIoTrace>();
        for (const trace of Object.values(context.liveNodeTraceByNodeId)) {
            map.set(trace.nodeId, trace);
        }
        return map;
    }, [context.liveNodeTraceByNodeId]);

    const initialNodes = useMemo(
        () => context.definition.nodes.map((node, index) => toNode(
            node,
            index,
            context.nodeUiStateByNodeId[node.nodeId],
            latestTraceByNodeId.get(node.nodeId),
            context.assetUploadBaseUrl,
            undefined,
            computeInputHandlesByPortKey(context.definition, node.nodeId, node.inputs)
        )),
        [context.assetUploadBaseUrl, context.definition.nodes, context.nodeUiStateByNodeId, latestTraceByNodeId]
    );
    const initialEdges = useMemo(
        () => context.definition.edges.map((edge) => toEdge(edge, selectEdgeById)),
        [context.definition.edges, selectEdgeById]
    );
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes((currentNodes) => {
            const positionByNodeId = new Map<string, XYPosition>(
                currentNodes.map((node) => [node.id, node.position])
            );
            const mappedNodes = context.definition.nodes.map((node, index) => (
                (() => {
                    const inputHandlesByPortKey = computeInputHandlesByPortKey(
                        context.definition,
                        node.nodeId,
                        node.inputs
                    );
                    return toNode(
                        node,
                        index,
                        context.nodeUiStateByNodeId[node.nodeId],
                        latestTraceByNodeId.get(node.nodeId),
                        context.assetUploadBaseUrl,
                        positionByNodeId.get(node.nodeId),
                        inputHandlesByPortKey
                    );
                })()
            ));
            if (hasSameCanvasNodeState(currentNodes, mappedNodes)) {
                return currentNodes;
            }
            return mappedNodes;
        });
    }, [context.assetUploadBaseUrl, context.definition.nodes, context.nodeUiStateByNodeId, latestTraceByNodeId, setNodes]);

    useEffect(() => {
        const mappedEdges = context.definition.edges.map((edge) => toEdge(edge, selectEdgeById));
        setEdges((currentEdges) => {
            if (hasSameCanvasEdgeState(currentEdges, mappedEdges)) {
                return currentEdges;
            }
            isSyncingEdgesFromDefinitionRef.current = true;
            return mappedEdges;
        });
    }, [context.definition.edges, setEdges, selectEdgeById]);
    const onNodeClick: NodeMouseHandler = (_event, node): void => {
        context.setSelectedNodeId(node.id);
        context.setSelectedEdgeId(undefined);
    };
    const onEdgeClick: EdgeMouseHandler = (_event, edge): void => {
        context.setSelectedEdgeId(edge.id);
        context.setSelectedNodeId(undefined);
    };
    const onNodeDragStop: NodeMouseHandler = (_event, node): void => {
        const originalNode = context.definition.nodes.find((definitionNode) => definitionNode.nodeId === node.id);
        if (!originalNode) {
            return;
        }
        const currentPosition = originalNode.position;
        const hasChanged = (
            !currentPosition
            || currentPosition.x !== node.position.x
            || currentPosition.y !== node.position.y
        );
        if (!hasChanged) {
            return;
        }
        const nextNodes = context.definition.nodes.map((definitionNode) => (
            definitionNode.nodeId === node.id
                ? {
                    ...definitionNode,
                    position: {
                        x: node.position.x,
                        y: node.position.y
                    }
                }
                : definitionNode
        ));
        context.onDefinitionChange({
            ...context.definition,
            nodes: nextNodes
        });
        context.resetRunProgress();
    };

    const isEditableTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        const tagName = target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
            return true;
        }
        return target.isContentEditable;
    };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') {
                return;
            }
            if (isEditableTarget(event.target)) {
                return;
            }
            if (!context.selectedEdgeId && !context.selectedNodeId) {
                return;
            }
            event.preventDefault();
            if (context.selectedEdgeId) {
                context.removeEdgeById(context.selectedEdgeId);
                return;
            }
            if (context.selectedNodeId) {
                context.removeNodeById(context.selectedNodeId);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [context.removeEdgeById, context.removeNodeById, context.selectedEdgeId, context.selectedNodeId]);

    const onConnect = (connection: Connection): void => {
        if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
            context.setConnectError('Connection rejected: source/target handles are required.');
            return;
        }

        context.setConnectError(undefined);

        const sourceNode = context.definition.nodes.find((node) => node.nodeId === connection.source);
        const targetNode = context.definition.nodes.find((node) => node.nodeId === connection.target);
        const targetInputPort = targetNode
            ? resolveInputPort(targetNode.inputs, connection.targetHandle).port
            : undefined;
        if (!targetInputPort) {
            context.setConnectError(`Connection rejected: input handle "${connection.targetHandle}" is invalid.`);
            return;
        }
        const targetInputIdentity = targetInputPort.isList
            ? connection.targetHandle
            : targetInputPort.key;
        const hasConflictingTargetBinding = context.definition.edges
            .filter((edge) => edge.to === connection.target)
            .some((edge) => (edge.bindings ?? []).some((binding) => {
                const existingTargetIdentity = targetInputPort.isList
                    ? binding.inputKey
                    : resolveInputPort(targetNode?.inputs ?? [], binding.inputKey).resolvedKey;
                return existingTargetIdentity === targetInputIdentity;
            }));
        if (hasConflictingTargetBinding) {
            context.setConnectError(`Connection rejected: input handle "${connection.targetHandle}" is already bound.`);
            return;
        }
        const nextNodes = context.definition.nodes.map((node) => {
            if (node.nodeId !== connection.target || !sourceNode) {
                return node;
            }
            const nextDependsOn = node.dependsOn.includes(sourceNode.nodeId)
                ? node.dependsOn
                : [...node.dependsOn, sourceNode.nodeId];
            return {
                ...node,
                dependsOn: nextDependsOn
            };
        });

        const newBinding = {
            outputKey: connection.sourceHandle,
            inputKey: connection.targetHandle
        };
        let shouldAbortConnection = false;
        const nextDefinition = compactListBindings({
            ...context.definition,
            nodes: nextNodes,
            edges: (() => {
                const existingEdge = context.definition.edges.find(
                    (edge) => edge.from === connection.source && edge.to === connection.target
                );
                if (!existingEdge) {
                    return [
                        ...context.definition.edges,
                        {
                            from: connection.source,
                            to: connection.target,
                            bindings: [newBinding]
                        }
                    ];
                }
                const bindingExists = (existingEdge.bindings ?? []).some((binding) => {
                    const existingTargetIdentity = targetInputPort.isList
                        ? binding.inputKey
                        : resolveInputPort(targetNode?.inputs ?? [], binding.inputKey).resolvedKey;
                    return (
                        existingTargetIdentity === targetInputIdentity
                        && binding.outputKey === newBinding.outputKey
                    );
                });
                if (bindingExists) {
                    context.setConnectError('Connection rejected: duplicate binding already exists.');
                    shouldAbortConnection = true;
                    return context.definition.edges;
                }
                return context.definition.edges.map((edge) => (
                    edge.from === connection.source && edge.to === connection.target
                        ? {
                            ...edge,
                            bindings: [...(edge.bindings ?? []), newBinding]
                        }
                        : edge
                ));
            })()
        });
        if (shouldAbortConnection) {
            return;
        }
        context.onDefinitionChange(nextDefinition);
        context.resetRunProgress();
    };

    useEffect(() => {
        if (isSyncingEdgesFromDefinitionRef.current) {
            isSyncingEdgesFromDefinitionRef.current = false;
        }
    }, [edges]);

    return (
        <div className={`flex min-h-[420px] flex-col overflow-hidden rounded border border-gray-300 ${props.className ?? ''}`}>
            {context.bindingErrors.length > 0 ? (
                <div className="relative z-10 shrink-0 border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <div className="font-medium">Blocking Binding Errors (from recent edits)</div>
                    {context.bindingErrors.map((error) => (
                        <div key={error}>- {error}</div>
                    ))}
                </div>
            ) : null}
            {context.connectError ? (
                <div className="relative z-10 shrink-0 border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                    <div className="font-medium">Connection Rejected</div>
                    <div>- {context.connectError}</div>
                </div>
            ) : null}
            {context.bindingCleanupMessage ? (
                <div className="relative z-10 shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <div className="font-medium">Port Update Applied</div>
                    <div>- {context.bindingCleanupMessage}</div>
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
                <ReactFlow
                    className="h-full"
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    nodesConnectable
                    connectionMode={ConnectionMode.Strict}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onEdgeClick={onEdgeClick}
                    onPaneClick={() => {
                        context.setSelectedNodeId(undefined);
                        context.setSelectedEdgeId(undefined);
                    }}
                    onNodeDragStop={onNodeDragStop}
                    panOnDrag={false}
                    panOnScroll
                    connectionLineType={ConnectionLineType.Bezier}
                    fitView
                    fitViewOptions={{ padding: 0.35, maxZoom: 0.8 }}
                >
                    <Background />
                    <Controls />
                </ReactFlow>
            </div>
        </div>
    );
}

export function DagDesignerNodeExplorer(props: IDagDesignerNodeExplorerProps): ReactElement {
    const context = useDagDesignerContext();
    return (
        <NodeExplorerPanel
            manifests={context.manifests}
            onAddNode={context.addNodeFromManifest}
            className={props.className}
        />
    );
}

export function DagDesignerInspector(props: IDagDesignerInspectorProps): ReactElement {
    return (
        <div className={`flex min-h-0 flex-col gap-4 overflow-auto ${props.className ?? ''}`}>
            <DagDesignerNodeConfig />
            <DagDesignerNodeIoTrace />
            <DagDesignerEdgeInspector />
        </div>
    );
}

export function DagDesignerNodeConfig(props: IDagDesignerNodeConfigProps): ReactElement {
    const context = useDagDesignerContext();
    const selectedNode = context.definition.nodes.find((node) => node.nodeId === context.selectedNodeId);
    const selectedManifest = context.manifests.find((manifest) => manifest.nodeType === selectedNode?.nodeType);
    return (
        <div className={props.className ?? ''}>
            <NodeConfigPanel
                node={selectedNode}
                definition={context.definition}
                manifest={selectedManifest}
                assetUploadBaseUrl={context.assetUploadBaseUrl}
                bindingCleanupMessage={context.bindingCleanupMessage}
                onUpdateNode={context.updateNode}
            />
        </div>
    );
}

export function DagDesignerEdgeInspector(props: IDagDesignerEdgeInspectorProps): ReactElement {
    const context = useDagDesignerContext();
    return (
        <div className={props.className ?? ''}>
            <EdgeInspectorPanel
                definition={context.definition}
                selectedEdgeId={context.selectedEdgeId}
                onUpdateEdge={context.updateEdge}
                onDeleteEdge={context.removeEdgeById}
            />
        </div>
    );
}

export function DagDesignerNodeIoTrace(props: IDagDesignerNodeIoTraceProps): ReactElement {
    const context = useDagDesignerContext();
    return (
        <div className={props.className ?? ''}>
            <NodeIoTracePanel
                traces={Object.values(context.liveNodeTraceByNodeId)}
                selectedNodeId={context.selectedNodeId}
                selectedNodeExecutionStatus={
                    context.selectedNodeId
                        ? context.nodeUiStateByNodeId[context.selectedNodeId]?.executionStatus
                        : undefined
                }
            />
        </div>
    );
}

export function DagDesignerRunProgressSummary(props: IDagDesignerRunProgressSummaryProps): ReactElement {
    const context = useDagDesignerContext();
    const state = context.runProgress;
    const runningNodeCount = Object.values(context.nodeUiStateByNodeId).filter((nodeState) => nodeState.executionStatus === 'running').length;
    const failedNodeCount = Object.values(context.nodeUiStateByNodeId).filter((nodeState) => nodeState.executionStatus === 'failed').length;
    const successNodeCount = Object.values(context.nodeUiStateByNodeId).filter((nodeState) => nodeState.executionStatus === 'success').length;
    const summaryText = state.activeDagRunId
        ? `run=${state.activeDagRunId} status=${state.runStatus} running=${runningNodeCount} success=${successNodeCount} failed=${failedNodeCount} completed=${state.completedTaskCount}`
        : 'run=none status=idle';

    return (
        <div className={`text-xs ${props.className ?? ''}`}>
            {summaryText}
        </div>
    );
}

export const DagDesigner = {
    Root: DagDesignerRoot,
    Canvas: DagDesignerCanvas,
    NodeExplorer: DagDesignerNodeExplorer,
    Inspector: DagDesignerInspector,
    NodeConfig: DagDesignerNodeConfig,
    NodeIoTrace: DagDesignerNodeIoTrace,
    EdgeInspector: DagDesignerEdgeInspector,
    RunProgressSummary: DagDesignerRunProgressSummary
} as const;
