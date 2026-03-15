import { useMemo } from 'react';
import type {
    IDagDefinition,
    IDagEdgeDefinition,
    IDagError,
    IDagNode,
    INodeManifest,
    IRunResult,
    TObjectInfo,
    TPortPayload,
    TResult
} from '@robota-sdk/dag-core';
import type { IRunProgressState } from '../components/dag-designer-canvas.js';
import { useDagDesignerContext } from '../components/dag-designer-canvas.js';

export interface IDagDesignerState {
    definition: IDagDefinition;
    manifests: INodeManifest[];
    objectInfo: TObjectInfo;
    runResult?: IRunResult;
    initialInput?: TPortPayload;
    selectedNodeId?: string;
    selectedEdgeId?: string;
    connectError?: string;
    bindingErrors: string[];
    runProgress: IRunProgressState;
    pendingOperations: Map<string, string>;
    hasPendingOperations: boolean;
}

export interface IDagDesignerActions {
    updateDefinition: (definition: IDagDefinition) => void;
    addNodeFromManifest: (manifest: INodeManifest) => void;
    updateNode: (node: IDagNode) => void;
    updateEdge: (edge: IDagEdgeDefinition) => void;
    setSelection: (selection: { nodeId?: string; edgeId?: string }) => void;
    setConnectError: (error: string | undefined) => void;
    onRunResult?: (result: TResult<IRunResult, IDagError>) => void;
    addPendingOperation: (nodeId: string, description: string) => void;
    removePendingOperation: (nodeId: string) => void;
}

export function useDagDesignerState(): IDagDesignerState {
    const context = useDagDesignerContext();
    return useMemo(() => ({
        definition: context.definition,
        manifests: context.manifests,
        objectInfo: context.objectInfo,
        runResult: context.runResult,
        initialInput: context.initialInput,
        selectedNodeId: context.selectedNodeId,
        selectedEdgeId: context.selectedEdgeId,
        connectError: context.connectError,
        bindingErrors: context.bindingErrors,
        runProgress: context.runProgress,
        pendingOperations: context.pendingOperations,
        hasPendingOperations: context.hasPendingOperations
    }), [
        context.bindingErrors,
        context.connectError,
        context.definition,
        context.initialInput,
        context.manifests,
        context.objectInfo,
        context.runResult,
        context.runProgress,
        context.selectedEdgeId,
        context.selectedNodeId,
        context.pendingOperations,
        context.hasPendingOperations
    ]);
}

export function useDagDesignerActions(): IDagDesignerActions {
    const context = useDagDesignerContext();
    return useMemo(() => ({
        updateDefinition: context.onDefinitionChange,
        addNodeFromManifest: context.addNodeFromManifest,
        updateNode: context.updateNode,
        updateEdge: context.updateEdge,
        setSelection: (selection: { nodeId?: string; edgeId?: string }) => {
            context.setSelectedNodeId(selection.nodeId);
            context.setSelectedEdgeId(selection.edgeId);
        },
        setConnectError: context.setConnectError,
        onRunResult: context.onRunResult,
        addPendingOperation: context.addPendingOperation,
        removePendingOperation: context.removePendingOperation
    }), [
        context.addNodeFromManifest,
        context.onDefinitionChange,
        context.onRunResult,
        context.setConnectError,
        context.setSelectedEdgeId,
        context.setSelectedNodeId,
        context.updateEdge,
        context.updateNode,
        context.addPendingOperation,
        context.removePendingOperation
    ]);
}
