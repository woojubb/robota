import { useMemo, type ReactElement } from 'react';
import { NodeConfigPanel } from './node-config-panel.js';
import { NodeIoTracePanel } from './node-io-trace-panel.js';
import { NodeExplorerPanel } from './node-explorer-panel.js';
import { EdgeInspectorPanel } from './edge-inspector-panel.js';
import { useDagDesignerContext, type TNodeExecutionStatus } from './dag-designer-context.js';
import type { IDagNodeIoTrace } from './dag-node-view.js';

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

export function DagDesignerNodeExplorer(props: IDagDesignerNodeExplorerProps): ReactElement {
    const context = useDagDesignerContext();
    return (
        <NodeExplorerPanel
            manifests={context.manifests}
            objectInfo={context.objectInfo}
            onAddNode={context.addNodeFromManifest}
            onAddNodeFromObjectInfo={context.addNodeFromObjectInfo}
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
    const selectedNode = useMemo(
        () => context.definition.nodes.find((node) => node.nodeId === context.selectedNodeId),
        [context.definition.nodes, context.selectedNodeId]
    );
    const selectedManifest = useMemo(
        () => context.manifests.find((manifest) => manifest.nodeType === selectedNode?.nodeType),
        [context.manifests, selectedNode?.nodeType]
    );
    const selectedObjectInfo = useMemo(
        () => selectedNode?.nodeType ? context.objectInfo[selectedNode.nodeType] : undefined,
        [context.objectInfo, selectedNode?.nodeType]
    );
    const pendingOperationDescription = selectedNode
        ? context.nodeStateMap[selectedNode.nodeId]?.pendingDescription
        : undefined;

    return (
        <div className={props.className ?? ''}>
            <NodeConfigPanel
                node={selectedNode}
                definition={context.definition}
                manifest={selectedManifest}
                nodeObjectInfo={selectedObjectInfo}
                assetUploadBaseUrl={context.assetUploadBaseUrl}
                bindingCleanupMessage={context.bindingCleanupMessage}
                onUpdateNode={context.updateNode}
                pendingOperationDescription={pendingOperationDescription}
                onPendingOperation={context.setNodeUploading}
                onPendingOperationDone={context.setNodeUploadDone}
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
    const traces = useMemo(
        () => {
            const result: IDagNodeIoTrace[] = [];
            for (const state of Object.values(context.nodeStateMap)) {
                if (state.trace) {
                    result.push(state.trace);
                }
            }
            return result;
        },
        [context.nodeStateMap]
    );
    const selectedNodeState = context.selectedNodeId
        ? context.nodeStateMap[context.selectedNodeId]
        : undefined;
    const selectedExecutionStatus = selectedNodeState?.operationStatus === 'uploading'
        ? 'idle' as const
        : (selectedNodeState?.operationStatus ?? 'idle') as TNodeExecutionStatus;
    return (
        <div className={props.className ?? ''}>
            <NodeIoTracePanel
                traces={traces}
                selectedNodeId={context.selectedNodeId}
                selectedNodeExecutionStatus={selectedExecutionStatus}
            />
        </div>
    );
}

export function DagDesignerRunProgressSummary(props: IDagDesignerRunProgressSummaryProps): ReactElement {
    const context = useDagDesignerContext();
    const state = context.runProgress;
    const { runningNodeCount, failedNodeCount, successNodeCount } = useMemo(() => {
        let running = 0;
        let failed = 0;
        let success = 0;
        for (const nodeState of Object.values(context.nodeStateMap)) {
            if (nodeState.operationStatus === 'running') running++;
            else if (nodeState.operationStatus === 'failed') failed++;
            else if (nodeState.operationStatus === 'success') success++;
        }
        return { runningNodeCount: running, failedNodeCount: failed, successNodeCount: success };
    }, [context.nodeStateMap]);
    const summaryText = state.activeDagRunId
        ? `run=${state.activeDagRunId} status=${state.runStatus} running=${runningNodeCount} success=${successNodeCount} failed=${failedNodeCount} completed=${state.completedTaskCount}`
        : 'run=none status=idle';

    return (
        <div className={`text-xs ${props.className ?? ''}`}>
            {summaryText}
        </div>
    );
}
