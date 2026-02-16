import type {
    IDagDefinition,
    IDagEdgeDefinition,
    IDagNode,
    IEdgeBinding,
    IPortDefinition,
    TBinaryKind,
    TPortValueType
} from '@robota-sdk/dag-core';

export type TPortDirection = 'inputs' | 'outputs';

export interface IPortFieldValidationError {
    index: number;
    field: 'key' | 'order' | 'binaryKind' | 'mimeTypes';
    message: string;
}

export interface IPortValidationResult {
    errors: IPortFieldValidationError[];
}

export interface IReconcileBindingRemoval {
    edgeId: string;
    binding: IEdgeBinding;
    reason: 'output_not_found' | 'input_not_found' | 'type_mismatch' | 'duplicate_input_in_edge' | 'duplicate_input_cross_edges';
}

export interface IReconcileNodeUpdateResult {
    nextDefinition: IDagDefinition;
    removedBindings: IReconcileBindingRemoval[];
}

function findPort(ports: IPortDefinition[], key: string): IPortDefinition | undefined {
    return ports.find((port) => port.key === key);
}

export function normalizePortOrders(ports: IPortDefinition[]): IPortDefinition[] {
    return ports.map((port, index) => ({
        ...port,
        order: index
    }));
}

export function validatePorts(ports: IPortDefinition[]): IPortValidationResult {
    const errors: IPortFieldValidationError[] = [];
    const keyMap = new Map<string, number[]>();

    ports.forEach((port, index) => {
        const trimmedKey = port.key.trim();
        if (trimmedKey.length === 0) {
            errors.push({
                index,
                field: 'key',
                message: 'Port key is required.'
            });
        }

        const existing = keyMap.get(trimmedKey) ?? [];
        keyMap.set(trimmedKey, [...existing, index]);

        if (typeof port.order !== 'undefined' && (!Number.isInteger(port.order) || port.order < 0)) {
            errors.push({
                index,
                field: 'order',
                message: 'Order must be a non-negative integer.'
            });
        }

        if (port.type === 'binary' && typeof port.binaryKind === 'undefined') {
            errors.push({
                index,
                field: 'binaryKind',
                message: 'binaryKind is required when type is binary.'
            });
        }

        if (
            port.type === 'binary'
            && typeof port.mimeTypes !== 'undefined'
            && !Array.isArray(port.mimeTypes)
        ) {
            errors.push({
                index,
                field: 'mimeTypes',
                message: 'mimeTypes must be a string array.'
            });
        }
    });

    for (const [key, indices] of keyMap.entries()) {
        if (key.length === 0 || indices.length < 2) {
            continue;
        }
        for (const index of indices) {
            errors.push({
                index,
                field: 'key',
                message: `Duplicate key "${key}" is not allowed.`
            });
        }
    }

    return { errors };
}

function isPortTypeCompatible(outputPort: IPortDefinition, inputPort: IPortDefinition): boolean {
    if (outputPort.type !== inputPort.type) {
        return false;
    }

    if (outputPort.type !== 'binary' || inputPort.type !== 'binary') {
        return true;
    }

    if (!outputPort.binaryKind || !inputPort.binaryKind) {
        return true;
    }

    if (outputPort.binaryKind !== inputPort.binaryKind) {
        return false;
    }

    if (!inputPort.mimeTypes || inputPort.mimeTypes.length === 0) {
        return true;
    }

    if (!outputPort.mimeTypes || outputPort.mimeTypes.length === 0) {
        return false;
    }

    return outputPort.mimeTypes.some((mimeType) => inputPort.mimeTypes?.includes(mimeType));
}

function rebuildDependsOn(nodes: IDagNode[], edges: IDagEdgeDefinition[]): IDagNode[] {
    const incomingByNode = new Map<string, Set<string>>();

    for (const edge of edges) {
        const incoming = incomingByNode.get(edge.to) ?? new Set<string>();
        incoming.add(edge.from);
        incomingByNode.set(edge.to, incoming);
    }

    return nodes.map((node) => ({
        ...node,
        dependsOn: Array.from(incomingByNode.get(node.nodeId) ?? [])
    }));
}

export function reconcileNodePortsAndEdges(
    definition: IDagDefinition,
    nextNode: IDagNode
): IReconcileNodeUpdateResult {
    const replacedNodes = definition.nodes.map((node) => (
        node.nodeId === nextNode.nodeId ? nextNode : node
    ));
    const nodeById = new Map(replacedNodes.map((node) => [node.nodeId, node]));

    const usedInputKeysByTarget = new Map<string, Set<string>>();
    const removedBindings: IReconcileBindingRemoval[] = [];
    const nextEdges: IDagEdgeDefinition[] = [];

    for (const edge of definition.edges) {
        const sourceNode = nodeById.get(edge.from);
        const targetNode = nodeById.get(edge.to);
        if (!sourceNode || !targetNode || !edge.bindings || edge.bindings.length === 0) {
            nextEdges.push(edge);
            continue;
        }

        const edgeId = `${edge.from}->${edge.to}`;
        const seenInputKeys = new Set<string>();
        const usedByTarget = usedInputKeysByTarget.get(edge.to) ?? new Set<string>();

        const keptBindings = edge.bindings.filter((binding) => {
            const outputPort = findPort(sourceNode.outputs, binding.outputKey);
            if (!outputPort) {
                removedBindings.push({ edgeId, binding, reason: 'output_not_found' });
                return false;
            }
            const inputPort = findPort(targetNode.inputs, binding.inputKey);
            if (!inputPort) {
                removedBindings.push({ edgeId, binding, reason: 'input_not_found' });
                return false;
            }
            if (!isPortTypeCompatible(outputPort, inputPort)) {
                removedBindings.push({ edgeId, binding, reason: 'type_mismatch' });
                return false;
            }
            if (seenInputKeys.has(binding.inputKey)) {
                removedBindings.push({ edgeId, binding, reason: 'duplicate_input_in_edge' });
                return false;
            }
            if (usedByTarget.has(binding.inputKey)) {
                removedBindings.push({ edgeId, binding, reason: 'duplicate_input_cross_edges' });
                return false;
            }

            seenInputKeys.add(binding.inputKey);
            usedByTarget.add(binding.inputKey);
            return true;
        });

        usedInputKeysByTarget.set(edge.to, usedByTarget);
        if (keptBindings.length === 0) {
            continue;
        }

        nextEdges.push({
            ...edge,
            bindings: keptBindings
        });
    }

    const nextNodes = rebuildDependsOn(replacedNodes, nextEdges);
    return {
        nextDefinition: {
            ...definition,
            nodes: nextNodes,
            edges: nextEdges
        },
        removedBindings
    };
}

export function getConnectedBindingCountForPort(
    definition: IDagDefinition | undefined,
    nodeId: string,
    direction: TPortDirection,
    portKey: string
): number {
    if (!definition) {
        return 0;
    }
    return definition.edges.reduce((count, edge) => {
        if (!edge.bindings || edge.bindings.length === 0) {
            return count;
        }
        const edgeMatches = direction === 'outputs'
            ? edge.from === nodeId
            : edge.to === nodeId;
        if (!edgeMatches) {
            return count;
        }
        const matchedCount = edge.bindings.filter((binding) => (
            direction === 'outputs'
                ? binding.outputKey === portKey
                : binding.inputKey === portKey
        )).length;
        return count + matchedCount;
    }, 0);
}

export function applyBulkRequired(
    ports: IPortDefinition[],
    selectedIndexes: number[],
    required: boolean
): IPortDefinition[] {
    const selectedSet = new Set<number>(selectedIndexes);
    return ports.map((port, index) => (
        selectedSet.has(index)
            ? { ...port, required }
            : port
    ));
}

export function applyBulkType(
    ports: IPortDefinition[],
    selectedIndexes: number[],
    nextType: TPortValueType
): IPortDefinition[] {
    const selectedSet = new Set<number>(selectedIndexes);
    return ports.map((port, index) => {
        if (!selectedSet.has(index)) {
            return port;
        }
        if (nextType === 'binary') {
            const nextBinaryKind: TBinaryKind = port.binaryKind ?? 'file';
            return {
                ...port,
                type: nextType,
                binaryKind: nextBinaryKind,
                mimeTypes: Array.isArray(port.mimeTypes) ? port.mimeTypes : []
            };
        }
        return {
            ...port,
            type: nextType,
            binaryKind: undefined,
            mimeTypes: undefined
        };
    });
}

export function removePortsByIndexes(
    ports: IPortDefinition[],
    selectedIndexes: number[]
): IPortDefinition[] {
    const selectedSet = new Set<number>(selectedIndexes);
    return ports.filter((_port, index) => !selectedSet.has(index));
}

export function summarizeRemovedBindings(removedBindings: IReconcileBindingRemoval[]): string | undefined {
    if (removedBindings.length === 0) {
        return undefined;
    }
    const edgeIds = Array.from(new Set(removedBindings.map((item) => item.edgeId)));
    return `Removed ${removedBindings.length} invalid bindings across ${edgeIds.length} edges: ${edgeIds.join(', ')}`;
}
