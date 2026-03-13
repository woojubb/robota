import { useMemo, type ReactElement } from 'react';
import { NodeConfigPanel } from './node-config-panel.js';
import { NodeIoTracePanel } from './node-io-trace-panel.js';
import { NodeExplorerPanel } from './node-explorer-panel.js';
import { EdgeInspectorPanel } from './edge-inspector-panel.js';
import { useDagDesignerContext } from './dag-designer-context.js';

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
    const { runningNodeCount, failedNodeCount, successNodeCount } = useMemo(() => {
        let running = 0;
        let failed = 0;
        let success = 0;
        for (const nodeState of Object.values(context.nodeUiStateByNodeId)) {
            if (nodeState.executionStatus === 'running') running++;
            else if (nodeState.executionStatus === 'failed') failed++;
            else if (nodeState.executionStatus === 'success') success++;
        }
        return { runningNodeCount: running, failedNodeCount: failed, successNodeCount: success };
    }, [context.nodeUiStateByNodeId]);
    const summaryText = state.activeDagRunId
        ? `run=${state.activeDagRunId} status=${state.runStatus} running=${runningNodeCount} success=${successNodeCount} failed=${failedNodeCount} completed=${state.completedTaskCount}`
        : 'run=none status=idle';

    return (
        <div className={`text-xs ${props.className ?? ''}`}>
            {summaryText}
        </div>
    );
}
