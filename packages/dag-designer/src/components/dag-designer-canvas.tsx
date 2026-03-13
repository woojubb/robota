import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    type ReactElement
} from 'react';
import {
    Background,
    type Connection,
    ConnectionMode,
    ConnectionLineType,
    Controls,
    type EdgeTypes,
    type EdgeMouseHandler,
    type NodeTypes,
    type NodeMouseHandler,
    type XYPosition,
    ReactFlow,
    useEdgesState,
    useNodesState
} from '@xyflow/react';
import { DagBindingEdge } from './dag-binding-edge.js';
import { DagNodeView, type IDagNodeIoTrace } from './dag-node-view.js';
import { resolveInputPort } from './port-editor-utils.js';
import {
    toNode,
    toEdge,
    hasSameCanvasNodeState,
    hasSameCanvasEdgeState,
    compactListBindings,
    computeInputHandlesByPortKey
} from './canvas-utils.js';
import { useDagDesignerContext, DagDesignerRoot } from './dag-designer-context.js';
import {
    DagDesignerNodeExplorer,
    DagDesignerInspector,
    DagDesignerNodeConfig,
    DagDesignerNodeIoTrace,
    DagDesignerEdgeInspector,
    DagDesignerRunProgressSummary
} from './dag-designer-panels.js';
import '@xyflow/react/dist/style.css';

// Re-export public types and components so existing consumers are unaffected.
export type {
    TNodeExecutionStatus,
    IRunProgressState,
    IRunProgressHooks,
    IDagDesignerRootProps,
    IDagDesignerContextValue
} from './dag-designer-context.js';
export { useDagDesignerContext, DagDesignerRoot } from './dag-designer-context.js';
export type {
    IDagDesignerNodeExplorerProps,
    IDagDesignerInspectorProps,
    IDagDesignerNodeConfigProps,
    IDagDesignerEdgeInspectorProps,
    IDagDesignerNodeIoTraceProps,
    IDagDesignerRunProgressSummaryProps
} from './dag-designer-panels.js';
export {
    DagDesignerNodeExplorer,
    DagDesignerInspector,
    DagDesignerNodeConfig,
    DagDesignerNodeIoTrace,
    DagDesignerEdgeInspector,
    DagDesignerRunProgressSummary
} from './dag-designer-panels.js';

const FIT_VIEW_OPTIONS = { padding: 0.35, maxZoom: 0.8 } as const;

export interface IDagDesignerCanvasProps {
    className?: string;
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
            const mappedNodes = context.definition.nodes.map((node, index) => {
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
            });
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

    const onNodeClick: NodeMouseHandler = useCallback((_event, node): void => {
        context.setSelectedNodeId(node.id);
        context.setSelectedEdgeId(undefined);
    }, [context.setSelectedNodeId, context.setSelectedEdgeId]);

    const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge): void => {
        context.setSelectedEdgeId(edge.id);
        context.setSelectedNodeId(undefined);
    }, [context.setSelectedEdgeId, context.setSelectedNodeId]);

    const onPaneClick = useCallback((): void => {
        context.setSelectedNodeId(undefined);
        context.setSelectedEdgeId(undefined);
    }, [context.setSelectedNodeId, context.setSelectedEdgeId]);

    const onNodeDragStop: NodeMouseHandler = (_event, node): void => {
        const originalNode = context.definition.nodes.find((n) => n.nodeId === node.id);
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
        const nextNodes = context.definition.nodes.map((n) => (
            n.nodeId === node.id
                ? { ...n, position: { x: node.position.x, y: node.position.y } }
                : n
        ));
        context.onDefinitionChange({ ...context.definition, nodes: nextNodes });
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
            return { ...node, dependsOn: nextDependsOn };
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
                        { from: connection.source, to: connection.target, bindings: [newBinding] }
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
                        ? { ...edge, bindings: [...(edge.bindings ?? []), newBinding] }
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
                    onPaneClick={onPaneClick}
                    onNodeDragStop={onNodeDragStop}
                    panOnDrag={false}
                    panOnScroll
                    connectionLineType={ConnectionLineType.Bezier}
                    fitView
                    fitViewOptions={FIT_VIEW_OPTIONS}
                >
                    <Background />
                    <Controls />
                </ReactFlow>
            </div>
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
