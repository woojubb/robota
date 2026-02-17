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
    addEdge,
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
import { DagNodeView, type IDagNodeViewData, type TDagCanvasNode } from './dag-node-view.js';
import { NodeConfigPanel } from './node-config-panel.js';
import { NodeIoTracePanel } from './node-io-trace-panel.js';
import { NodeExplorerPanel } from './node-explorer-panel.js';
import { reconcileNodePortsAndEdges, summarizeRemovedBindings } from './port-editor-utils.js';
import type { IRunResult } from '../contracts/designer-api.js';
import '@xyflow/react/dist/style.css';

export type TNodeExecutionStatus = 'idle' | 'running' | 'success' | 'failed';

export interface IRunProgressState {
    activeDagRunId?: string;
    runStatus: 'idle' | 'running' | 'success' | 'failed';
    nodeStatusByNodeId: Record<string, TNodeExecutionStatus>;
    currentNodeId?: string;
    failedNodeId?: string;
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
    nodeStatusByNodeId: {},
    completedTaskCount: 0
};
const MIN_RUNNING_DISPLAY_DURATION_MS = 400;

function applyRunProgressEventToState(
    currentState: IRunProgressState,
    event: TRunProgressEvent
): IRunProgressState {
    const nextNodeStatusByNodeId = { ...currentState.nodeStatusByNodeId };
    if (event.eventType === TASK_PROGRESS_EVENTS.STARTED) {
        nextNodeStatusByNodeId[event.nodeId] = 'running';
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: 'running',
            nodeStatusByNodeId: nextNodeStatusByNodeId,
            currentNodeId: event.nodeId,
            latestEventType: event.eventType
        };
    }
    if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED) {
        nextNodeStatusByNodeId[event.nodeId] = 'success';
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: currentState.runStatus === 'failed' ? 'failed' : 'running',
            nodeStatusByNodeId: nextNodeStatusByNodeId,
            completedTaskCount: currentState.completedTaskCount + 1,
            latestEventType: event.eventType
        };
    }
    if (event.eventType === TASK_PROGRESS_EVENTS.FAILED) {
        nextNodeStatusByNodeId[event.nodeId] = 'failed';
        return {
            ...currentState,
            activeDagRunId: currentState.activeDagRunId ?? event.dagRunId,
            runStatus: 'failed',
            nodeStatusByNodeId: nextNodeStatusByNodeId,
            currentNodeId: event.nodeId,
            failedNodeId: event.nodeId,
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
    executionStatus: TNodeExecutionStatus,
    positionOverride?: XYPosition
): TDagCanvasNode {
    return {
        id: nodeDefinition.nodeId,
        type: 'dag-node',
        dragHandle: '.dag-node-drag-handle',
        data: {
            label: nodeDefinition.nodeId,
            nodeType: nodeDefinition.nodeType,
            inputs: nodeDefinition.inputs,
            outputs: nodeDefinition.outputs,
            executionStatus
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
        return (
            currentNode.id === nextNode.id &&
            currentNode.position.x === nextNode.position.x &&
            currentNode.position.y === nextNode.position.y &&
            currentExecutionStatus === nextExecutionStatus
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

function findPort(ports: IPortDefinition[], key: string): IPortDefinition | undefined {
    return ports.find((port) => port.key === key);
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
            const inputPort = findPort(toNode.inputs, binding.inputKey);
            if (!inputPort) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: input key "${binding.inputKey}" was removed or not found.`
                );
            }
            if (outputPort && inputPort && outputPort.type !== inputPort.type) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: type mismatch "${binding.outputKey}"(${outputPort.type}) -> "${binding.inputKey}"(${inputPort.type}).`
                );
            }
            if (usedInEdge.has(binding.inputKey)) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: duplicate input key "${binding.inputKey}" in same edge.`
                );
            } else {
                usedInEdge.add(binding.inputKey);
            }

            const usedByTarget = usedInputKeysByTarget.get(edge.to) ?? new Set<string>();
            if (usedByTarget.has(binding.inputKey)) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: input key "${binding.inputKey}" conflicts with another upstream edge.`
                );
            } else {
                usedByTarget.add(binding.inputKey);
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
    const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>(undefined);
    const [connectError, setConnectError] = useState<string | undefined>(undefined);
    const [bindingCleanupMessage, setBindingCleanupMessage] = useState<string | undefined>(undefined);
    const [runResult, setRunResult] = useState<IRunResult | undefined>(undefined);
    const [runProgress, setRunProgress] = useState<IRunProgressState>(INITIAL_RUN_PROGRESS_STATE);
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

    const resetRunProgress = useCallback((): void => {
        clearPendingStatusTimers();
        nodeRunningSinceRef.current.clear();
        setRunProgress(INITIAL_RUN_PROGRESS_STATE);
    }, [clearPendingStatusTimers]);

    const setActiveDagRunId = useCallback((dagRunId: string): void => {
        clearPendingStatusTimers();
        nodeRunningSinceRef.current.clear();
        setRunProgress({
            activeDagRunId: dagRunId,
            runStatus: 'running',
            nodeStatusByNodeId: {},
            completedTaskCount: 0
        });
    }, [clearPendingStatusTimers]);

    const applyRunProgressEvent = useCallback((event: TRunProgressEvent): void => {
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
        setRunResult(undefined);
        resetRunProgress();
        props.onDefinitionChange({
            ...props.definition,
            nodes: [...props.definition.nodes, nextNode]
        });
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const updateNode = useCallback((nextNode: IDagNode): void => {
        const reconciled = reconcileNodePortsAndEdges(props.definition, nextNode);
        setBindingCleanupMessage(summarizeRemovedBindings(reconciled.removedBindings));
        setRunResult(undefined);
        resetRunProgress();
        props.onDefinitionChange(reconciled.nextDefinition);
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const updateEdge = useCallback((nextEdge: IDagEdgeDefinition): void => {
        setBindingCleanupMessage(undefined);
        setRunResult(undefined);
        resetRunProgress();
        props.onDefinitionChange({
            ...props.definition,
            edges: props.definition.edges.map((edge) => (
                edge.from === nextEdge.from && edge.to === nextEdge.to ? nextEdge : edge
            ))
        });
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const removeEdgeById = useCallback((edgeId: string): void => {
        const nextEdges = props.definition.edges.filter((edge) => `${edge.from}->${edge.to}` !== edgeId);
        if (nextEdges.length === props.definition.edges.length) {
            return;
        }
        setBindingCleanupMessage(undefined);
        setRunResult(undefined);
        resetRunProgress();
        setSelectedEdgeId(undefined);
        const nextNodes = recomputeNodeDependencies(props.definition.nodes, nextEdges);
        props.onDefinitionChange({
            ...props.definition,
            nodes: nextNodes,
            edges: nextEdges
        });
    }, [props.definition, props.onDefinitionChange, resetRunProgress]);

    const removeNodeById = useCallback((nodeId: string): void => {
        const nextNodes = props.definition.nodes.filter((node) => node.nodeId !== nodeId);
        if (nextNodes.length === props.definition.nodes.length) {
            return;
        }
        const nextEdges = props.definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
        const reconciledNodes = recomputeNodeDependencies(nextNodes, nextEdges);
        setBindingCleanupMessage(undefined);
        setRunResult(undefined);
        resetRunProgress();
        setSelectedNodeId(undefined);
        setSelectedEdgeId(undefined);
        props.onDefinitionChange({
            ...props.definition,
            nodes: reconciledNodes,
            edges: nextEdges
        });
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

    const initialNodes = useMemo(
        () => context.definition.nodes.map((node, index) => toNode(
            node,
            index,
            context.runProgress.nodeStatusByNodeId[node.nodeId] ?? 'idle'
        )),
        [context.definition.nodes, context.runProgress.nodeStatusByNodeId]
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
                toNode(
                    node,
                    index,
                    context.runProgress.nodeStatusByNodeId[node.nodeId] ?? 'idle',
                    positionByNodeId.get(node.nodeId)
                )
            ));
            if (hasSameCanvasNodeState(currentNodes, mappedNodes)) {
                return currentNodes;
            }
            return mappedNodes;
        });
    }, [context.definition.nodes, context.runProgress.nodeStatusByNodeId, setNodes]);

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
        context.setRunResult(undefined);
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

        const existingEdgeIndex = context.definition.edges.findIndex(
            (edge) => edge.from === connection.source && edge.to === connection.target
        );
        if (existingEdgeIndex >= 0) {
            context.setConnectError(`Connection rejected: edge ${connection.source}->${connection.target} already exists.`);
            return;
        }
        context.setConnectError(undefined);

        const nextEdges = addEdge(
            {
                id: `${connection.source}->${connection.target}`,
                type: 'binding-edge',
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle,
                targetHandle: connection.targetHandle,
                data: {
                    shortLabel: `${connection.sourceHandle} -> ${connection.targetHandle}`,
                    fullLabel: `${connection.sourceHandle} -> ${connection.targetHandle}`,
                    hasBinding: true,
                    onSelectEdge: selectEdgeById
                } satisfies IDagBindingEdgeData
            },
            edges
        );
        setEdges(nextEdges);

        const sourceNode = context.definition.nodes.find((node) => node.nodeId === connection.source);
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

        context.onDefinitionChange({
            ...context.definition,
            nodes: nextNodes,
            edges: [
                ...context.definition.edges,
                {
                    from: connection.source,
                    to: connection.target,
                    bindings: [newBinding]
                }
            ]
        });
        context.setRunResult(undefined);
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
                runResult={context.runResult}
                selectedNodeId={context.selectedNodeId}
                selectedNodeExecutionStatus={
                    context.selectedNodeId
                        ? context.runProgress.nodeStatusByNodeId[context.selectedNodeId]
                        : undefined
                }
            />
        </div>
    );
}

export function DagDesignerRunProgressSummary(props: IDagDesignerRunProgressSummaryProps): ReactElement {
    const context = useDagDesignerContext();
    const state = context.runProgress;
    const runningNodeCount = Object.values(state.nodeStatusByNodeId).filter((status) => status === 'running').length;
    const failedNodeCount = Object.values(state.nodeStatusByNodeId).filter((status) => status === 'failed').length;
    const successNodeCount = Object.values(state.nodeStatusByNodeId).filter((status) => status === 'success').length;
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
