import { useMemo } from 'react';
import type {
    IDagDefinition,
    IDagEdgeDefinition,
    IDagNode,
    INodeManifest,
    TPortPayload
} from '@robota-sdk/dag-core';
import type { IPreviewResult } from '../lifecycle/preview-engine.js';
import type { IDagError, TResult } from '@robota-sdk/dag-core';
import { useDagDesignerContext } from '../components/dag-designer-canvas.js';

export interface IDagDesignerState {
    definition: IDagDefinition;
    manifests: INodeManifest[];
    previewResult?: IPreviewResult;
    initialInput?: TPortPayload;
    selectedNodeId?: string;
    selectedEdgeId?: string;
    connectError?: string;
    bindingErrors: string[];
}

export interface IDagDesignerActions {
    updateDefinition: (definition: IDagDefinition) => void;
    addNodeFromManifest: (manifest: INodeManifest) => void;
    updateNode: (node: IDagNode) => void;
    updateEdge: (edge: IDagEdgeDefinition) => void;
    setSelection: (selection: { nodeId?: string; edgeId?: string }) => void;
    setConnectError: (error: string | undefined) => void;
    onPreviewResult?: (result: TResult<IPreviewResult, IDagError>) => void;
}

export function useDagDesignerState(): IDagDesignerState {
    const context = useDagDesignerContext();
    return useMemo(() => ({
        definition: context.definition,
        manifests: context.manifests,
        previewResult: context.previewResult,
        initialInput: context.initialInput,
        selectedNodeId: context.selectedNodeId,
        selectedEdgeId: context.selectedEdgeId,
        connectError: context.connectError,
        bindingErrors: context.bindingErrors
    }), [
        context.bindingErrors,
        context.connectError,
        context.definition,
        context.initialInput,
        context.manifests,
        context.previewResult,
        context.selectedEdgeId,
        context.selectedNodeId
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
        onPreviewResult: context.onPreviewResult
    }), [
        context.addNodeFromManifest,
        context.onDefinitionChange,
        context.onPreviewResult,
        context.setConnectError,
        context.setSelectedEdgeId,
        context.setSelectedNodeId,
        context.updateEdge,
        context.updateNode
    ]);
}
