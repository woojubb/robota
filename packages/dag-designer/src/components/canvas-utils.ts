import {
    buildListPortHandleKey,
    parseListPortHandleKey,
    type IDagDefinition,
    type IDagEdgeDefinition,
    type IDagNode,
    type INodeManifest,
    type INodeObjectInfo,
    type IPortDefinition,
    type TObjectInfo,
    type TPortValueType
} from '@robota-sdk/dag-core';
import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { IDagNodeIoTrace, IDagNodeViewData, TDagCanvasNode } from './dag-node-view.js';
import type { IDagBindingEdgeData } from './dag-binding-edge.js';
import type { INodeState, TNodeExecutionStatus } from './dag-designer-context.js';

export function toNode(
    nodeDefinition: IDagNode,
    index: number,
    nodeState: INodeState | undefined,
    latestTrace?: IDagNodeIoTrace,
    assetBaseUrl?: string,
    positionOverride?: XYPosition,
    inputHandlesByPortKey?: Record<string, string[]>,
    objectInfo?: TObjectInfo
): TDagCanvasNode {
    const nodeInfo = objectInfo?.[nodeDefinition.nodeType];
    const inputs = (nodeDefinition.inputs && nodeDefinition.inputs.length > 0)
        ? nodeDefinition.inputs
        : nodeInfo
            ? deriveInputPorts(nodeInfo)
            : [];
    const outputs = (nodeDefinition.outputs && nodeDefinition.outputs.length > 0)
        ? nodeDefinition.outputs
        : nodeInfo
            ? deriveOutputPorts(nodeInfo)
            : [];

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
            inputs,
            outputs,
            executionStatus: nodeState?.operationStatus === 'uploading' ? 'idle' : (nodeState?.operationStatus ?? 'idle') as TNodeExecutionStatus,
            isSelected: nodeState?.isSelected ?? false,
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

export function toEdge(
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

export function hasSameCanvasNodeState(currentNodes: Node[], nextNodes: Node[]): boolean {
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
        const currentHandles = (currentNode.data as { inputHandlesByPortKey?: Record<string, string[]> } | undefined)?.inputHandlesByPortKey;
        const nextHandles = (nextNode.data as { inputHandlesByPortKey?: Record<string, string[]> } | undefined)?.inputHandlesByPortKey;
        const handlesChanged = JSON.stringify(currentHandles) !== JSON.stringify(nextHandles);
        return (
            currentNode.id === nextNode.id &&
            currentNode.position.x === nextNode.position.x &&
            currentNode.position.y === nextNode.position.y &&
            currentExecutionStatus === nextExecutionStatus &&
            currentSelected === nextSelected &&
            currentTraceSignature === nextTraceSignature &&
            !handlesChanged
        );
    });
}

export function hasSameCanvasEdgeState(currentEdges: Edge[], nextEdges: Edge[]): boolean {
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

export function createNodeFromManifest(manifest: INodeManifest, index: number): IDagNode {
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

function mapComfyTypeToPortType(comfyType: string): TPortValueType {
    const upper = comfyType.toUpperCase();
    if (upper === 'INT' || upper === 'FLOAT') return 'number';
    if (upper === 'STRING') return 'string';
    if (upper === 'BOOLEAN' || upper === 'BOOL') return 'boolean';
    if (upper === 'IMAGE' || upper === 'MASK' || upper === 'VIDEO' || upper === 'AUDIO' || upper === 'BINARY') return 'binary';
    return 'object';
}

export function createNodeFromObjectInfo(
    nodeType: string,
    info: INodeObjectInfo,
    index: number
): IDagNode {
    return {
        nodeId: `${nodeType}_${index + 1}`,
        nodeType,
        position: { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 },
        dependsOn: [],
        config: {},
    };
}

export function deriveInputPorts(info: INodeObjectInfo): IPortDefinition[] {
    const ports: IPortDefinition[] = [];
    let order = 0;
    for (const [key, spec] of Object.entries(info.input.required ?? {})) {
        const typeName = Array.isArray(spec) && typeof spec[0] === 'string' ? spec[0] : 'STRING';
        ports.push({
            key,
            label: key.charAt(0).toUpperCase() + key.slice(1),
            order: order++,
            type: mapComfyTypeToPortType(typeName),
            required: true,
        });
    }
    for (const [key, spec] of Object.entries(info.input.optional ?? {})) {
        const typeName = Array.isArray(spec) && typeof spec[0] === 'string' ? spec[0] : 'STRING';
        ports.push({
            key,
            label: key.charAt(0).toUpperCase() + key.slice(1),
            order: order++,
            type: mapComfyTypeToPortType(typeName),
            required: false,
        });
    }
    return ports;
}

export function deriveOutputPorts(info: INodeObjectInfo): IPortDefinition[] {
    const ports: IPortDefinition[] = [];
    for (let i = 0; i < info.output.length; i++) {
        ports.push({
            key: (info.output_name[i] ?? info.output[i] ?? `output_${i}`).toLowerCase(),
            label: info.output_name[i] ?? info.output[i],
            order: i,
            type: mapComfyTypeToPortType(info.output[i] ?? 'STRING'),
            required: true,
            isList: info.output_is_list[i] ?? false,
        });
    }
    return ports;
}

/**
 * Enriches a node with port definitions derived from objectInfo when the node
 * does not have its own inputs/outputs (new nodes created without port data).
 */
export function enrichNodeWithPorts(node: IDagNode, objectInfo?: TObjectInfo): IDagNode {
    if (node.inputs && node.inputs.length > 0 && node.outputs && node.outputs.length > 0) {
        return node;
    }
    const info = objectInfo?.[node.nodeType];
    if (!info) {
        return node;
    }
    return {
        ...node,
        inputs: (node.inputs && node.inputs.length > 0) ? node.inputs : deriveInputPorts(info),
        outputs: (node.outputs && node.outputs.length > 0) ? node.outputs : deriveOutputPorts(info),
    };
}

export function compactListBindings(definition: IDagDefinition): IDagDefinition {
    // Track list binding indices across ALL edges per (targetNodeId, listPortKey)
    const indexCounterByTargetAndPort = new Map<string, number>();

    const nextEdges = definition.edges.map((edge) => {
        if (!edge.bindings || edge.bindings.length === 0) {
            return edge;
        }
        const targetNode = definition.nodes.find((node) => node.nodeId === edge.to);
        if (!targetNode) {
            return edge;
        }
        const listInputPorts = (targetNode.inputs ?? []).filter((port) => port.isList);
        if (listInputPorts.length === 0) {
            return edge;
        }
        const nextBindings = edge.bindings.map((binding) => {
            const listHandle = parseListPortHandleKey(binding.inputKey);
            const directListPort = (targetNode.inputs ?? []).find((port) => port.key === binding.inputKey && port.isList);
            const listPortKey = directListPort
                ? directListPort.key
                : listHandle?.portKey;
            if (!listPortKey) {
                return binding;
            }
            const listPort = (targetNode.inputs ?? []).find((port) => port.key === listPortKey && port.isList);
            if (!listPort) {
                return binding;
            }
            const counterKey = `${edge.to}::${listPortKey}`;
            const nextIndex = indexCounterByTargetAndPort.get(counterKey) ?? 0;
            indexCounterByTargetAndPort.set(counterKey, nextIndex + 1);
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

export function computeInputHandlesByPortKey(
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

export function computeBindingErrors(definition: IDagDefinition): string[] {
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
            const outputPort = findPort(fromNode.outputs ?? [], binding.outputKey);
            if (!outputPort) {
                errors.push(
                    `Edge ${edge.from}->${edge.to}: output key "${binding.outputKey}" was removed or not found.`
                );
            }
            const resolvedInput = resolveInputPort(toNode.inputs ?? [], binding.inputKey);
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

export function recomputeNodeDependencies(
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

// Re-export from port-editor-utils for use in canvas connection logic
import { findPort, resolveInputPort } from './port-editor-utils.js';
export { findPort, resolveInputPort };
