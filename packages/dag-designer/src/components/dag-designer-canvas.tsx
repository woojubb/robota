import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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
import type {
    IDagDefinition,
    IDagEdgeDefinition,
    IDagError,
    IDagNodeDefinition,
    INodeManifest,
    IPortDefinition,
    TPortPayload,
    TResult
} from '@robota-sdk/dag-core';
import { EdgeInspectorPanel } from './edge-inspector-panel.js';
import { DagBindingEdge, type IDagBindingEdgeData } from './dag-binding-edge.js';
import { DagNodeView, type IDagNodeViewData, type TDagCanvasNode } from './dag-node-view.js';
import { NodeConfigPanel } from './node-config-panel.js';
import { NodeExplorerPanel } from './node-explorer-panel.js';
import { runDefinitionPreview, type IPreviewResult } from '../lifecycle/preview-engine.js';
import '@xyflow/react/dist/style.css';

export interface IDagDesignerCanvasProps {
    definition: IDagDefinition;
    manifests: INodeManifest[];
    onDefinitionChange: (definition: IDagDefinition) => void;
    onPreviewResult?: (result: TResult<IPreviewResult, IDagError>) => void;
    initialInput?: TPortPayload;
    className?: string;
}

function toNode(
    nodeDefinition: IDagNodeDefinition,
    index: number,
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
            outputs: nodeDefinition.outputs
        } satisfies IDagNodeViewData,
        position: positionOverride ?? { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 }
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

function toDefinitionEdge(edge: Edge): IDagEdgeDefinition {
    return {
        from: edge.source,
        to: edge.target,
        bindings: []
    };
}

function hasSameEdgeShape(nextEdges: Edge[], currentEdges: IDagEdgeDefinition[]): boolean {
    if (nextEdges.length !== currentEdges.length) {
        return false;
    }

    const currentEdgeIds = new Set(currentEdges.map((edge) => `${edge.from}->${edge.to}`));
    return nextEdges.every((edge) => currentEdgeIds.has(`${edge.source}->${edge.target}`));
}

function createNodeFromManifest(manifest: INodeManifest, index: number): IDagNodeDefinition {
    return {
        nodeId: `${manifest.nodeType}_${index + 1}`,
        nodeType: manifest.nodeType,
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

export function DagDesignerCanvas(props: IDagDesignerCanvasProps): ReactElement {
    const nodeTypes = useMemo<NodeTypes>(() => ({ 'dag-node': DagNodeView }), []);
    const edgeTypes = useMemo<EdgeTypes>(() => ({ 'binding-edge': DagBindingEdge }), []);
    const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>(undefined);
    const [connectError, setConnectError] = useState<string | undefined>(undefined);
    const bindingErrors = useMemo(() => computeBindingErrors(props.definition), [props.definition]);

    const selectEdgeById = useCallback((edgeId: string): void => {
        setSelectedEdgeId(edgeId);
        setSelectedNodeId(undefined);
    }, []);

    const initialNodes = useMemo(() => props.definition.nodes.map((node, index) => toNode(node, index)), [props.definition.nodes]);
    const initialEdges = useMemo(
        () => props.definition.edges.map((edge) => toEdge(edge, selectEdgeById)),
        [props.definition.edges, selectEdgeById]
    );
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes((currentNodes) => {
            const positionByNodeId = new Map<string, XYPosition>(
                currentNodes.map((node) => [node.id, node.position])
            );
            return props.definition.nodes.map((node, index) => (
                toNode(node, index, positionByNodeId.get(node.nodeId))
            ));
        });
    }, [props.definition.nodes, setNodes]);

    useEffect(() => {
        setEdges(props.definition.edges.map((edge) => toEdge(edge, selectEdgeById)));
    }, [props.definition.edges, setEdges, selectEdgeById]);
    const onNodeClick: NodeMouseHandler = (_event, node): void => {
        setSelectedNodeId(node.id);
        setSelectedEdgeId(undefined);
    };
    const onEdgeClick: EdgeMouseHandler = (_event, edge): void => {
        setSelectedEdgeId(edge.id);
        setSelectedNodeId(undefined);
    };

    const updateDefinitionByEdges = useCallback((nextEdges: Edge[]): void => {
        if (hasSameEdgeShape(nextEdges, props.definition.edges)) {
            return;
        }
        const currentEdgesById = new Map(props.definition.edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
        props.onDefinitionChange({
            ...props.definition,
            edges: nextEdges.map((edge) => {
                const existing = currentEdgesById.get(edge.id);
                return existing ?? toDefinitionEdge(edge);
            })
        });
    }, [props.definition, props.onDefinitionChange]);

    const onConnect = (connection: Connection): void => {
        if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
            setConnectError('Connection rejected: source/target handles are required.');
            return;
        }

        const existingEdgeIndex = props.definition.edges.findIndex(
            (edge) => edge.from === connection.source && edge.to === connection.target
        );
        if (existingEdgeIndex >= 0) {
            setConnectError(`Connection rejected: edge ${connection.source}->${connection.target} already exists.`);
            return;
        }
        setConnectError(undefined);

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

        const sourceNode = props.definition.nodes.find((node) => node.nodeId === connection.source);
        const nextNodes = props.definition.nodes.map((node) => {
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

        props.onDefinitionChange({
            ...props.definition,
            nodes: nextNodes,
            edges: [
                ...props.definition.edges,
                {
                    from: connection.source,
                    to: connection.target,
                    bindings: [newBinding]
                }
            ]
        });
    };

    useEffect(() => {
        updateDefinitionByEdges(edges);
    }, [edges, updateDefinitionByEdges]);

    const handleAddNode = (manifest: INodeManifest): void => {
        const nextNode = createNodeFromManifest(manifest, props.definition.nodes.length);
        const nextDefinition: IDagDefinition = {
            ...props.definition,
            nodes: [...props.definition.nodes, nextNode]
        };
        props.onDefinitionChange(nextDefinition);
        setNodes([...nodes, toNode(nextNode, nextDefinition.nodes.length - 1)]);
    };

    const selectedNode = props.definition.nodes.find((node) => node.nodeId === selectedNodeId);

    const updateNode = (nextNode: IDagNodeDefinition): void => {
        props.onDefinitionChange({
            ...props.definition,
            nodes: props.definition.nodes.map((node) => node.nodeId === nextNode.nodeId ? nextNode : node)
        });
    };

    const updateEdge = (nextEdge: IDagEdgeDefinition): void => {
        props.onDefinitionChange({
            ...props.definition,
            edges: props.definition.edges.map((edge) => (
                edge.from === nextEdge.from && edge.to === nextEdge.to ? nextEdge : edge
            ))
        });
    };

    const canRunPreview = bindingErrors.length === 0;

    const runPreview = async (): Promise<void> => {
        if (!canRunPreview) {
            return;
        }
        const previewResult = await runDefinitionPreview(
            props.definition,
            props.initialInput ?? {}
        );
        props.onPreviewResult?.(previewResult);
    };

    return (
        <div className={`grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_320px] ${props.className ?? 'h-[760px]'}`}>
            <div className="min-h-0 overflow-auto rounded border border-gray-200 lg:w-[260px] lg:min-w-[260px] lg:max-w-[260px] lg:border-0">
                <NodeExplorerPanel manifests={props.manifests} onAddNode={handleAddNode} />
            </div>
            <div className="flex min-h-[420px] flex-col overflow-hidden rounded border border-gray-300">
                <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-gray-300 bg-white px-3 py-2">
                    <h2 className="text-sm font-semibold">DAG Canvas</h2>
                    <button
                        type="button"
                        className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={runPreview}
                        disabled={!canRunPreview}
                    >
                        Run Preview
                    </button>
                </div>
                {bindingErrors.length > 0 ? (
                    <div className="relative z-10 shrink-0 border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                        <div className="font-medium">Blocking Binding Errors</div>
                        {bindingErrors.map((error) => (
                            <div key={error}>- {error}</div>
                        ))}
                    </div>
                ) : null}
                {connectError ? (
                    <div className="relative z-10 shrink-0 border-b border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                        <div className="font-medium">Connection Rejected</div>
                        <div>- {connectError}</div>
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
                        panOnDrag={false}
                        panOnScroll
                        connectionLineType={ConnectionLineType.Bezier}
                        connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2 }}
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                    >
                        <Background />
                        <Controls />
                    </ReactFlow>
                </div>
            </div>
            <div className="flex min-h-0 flex-col gap-4 overflow-auto">
                <NodeConfigPanel node={selectedNode} onUpdateNode={updateNode} />
                <EdgeInspectorPanel
                    definition={props.definition}
                    selectedEdgeId={selectedEdgeId}
                    onUpdateEdge={updateEdge}
                />
            </div>
        </div>
    );
}
