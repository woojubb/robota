import { useMemo, type ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { buildListPortHandleKey, type IPortDefinition, type TPortPayload } from '@robota-sdk/dag-core';
import type { TNodeExecutionStatus } from './dag-designer-canvas.js';
import { NodeIoViewer } from './node-io-viewer.js';

export interface IDagNodeIoTrace {
    nodeId: string;
    input?: TPortPayload;
    output?: TPortPayload;
}

export interface IDagNodeViewData extends Record<string, unknown> {
    label: string;
    nodeType: string;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    executionStatus?: TNodeExecutionStatus;
    isSelected?: boolean;
    latestTrace?: IDagNodeIoTrace;
    assetBaseUrl?: string;
    traceSignature?: string;
    inputHandlesByPortKey?: Record<string, string[]>;
}

export type TDagCanvasNode = Node<IDagNodeViewData, 'dag-node'>;

/** Category color map for node accent styling. */
const CATEGORY_COLORS: Record<string, { accent: string; dim: string }> = {
    'ai-inference': { accent: 'var(--studio-accent-violet, #a78bfa)', dim: 'rgba(167, 139, 250, 0.15)' },
    'transform': { accent: 'var(--studio-accent-cyan, #22d3ee)', dim: 'rgba(34, 211, 238, 0.15)' },
    'io': { accent: 'var(--studio-accent-amber, #fbbf24)', dim: 'rgba(251, 191, 36, 0.15)' },
    'custom': { accent: 'var(--studio-accent-rose, #fb7185)', dim: 'rgba(251, 113, 133, 0.15)' }
};

const DEFAULT_CATEGORY_COLOR = { accent: 'var(--studio-text-muted, #5c5c7a)', dim: 'rgba(92, 92, 122, 0.15)' };

function getCategoryColor(nodeType: string): { accent: string; dim: string } {
    for (const [key, value] of Object.entries(CATEGORY_COLORS)) {
        if (nodeType.toLowerCase().includes(key)) {
            return value;
        }
    }
    return DEFAULT_CATEGORY_COLOR;
}

const NO_TRACE_FALLBACK = (
    <div
        className="nodrag px-3 py-2 text-[10px]"
        style={{
            borderTop: '1px solid var(--studio-border-subtle, #2d2d44)',
            color: 'var(--studio-text-muted, #5c5c7a)'
        }}
    >
        No run data yet
    </div>
);

function sortPorts(ports: IPortDefinition[]): IPortDefinition[] {
    return [...ports].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
}

export function DagNodeView(props: NodeProps<TDagCanvasNode>): ReactElement {
    const inputs = useMemo(() => sortPorts(props.data.inputs), [props.data.inputs]);
    const outputs = useMemo(() => sortPorts(props.data.outputs), [props.data.outputs]);
    const executionStatus = props.data.executionStatus ?? 'idle';
    const isSelected = props.data.isSelected ?? false;
    const categoryColor = getCategoryColor(props.data.nodeType);
    const latestTrace = props.data.latestTrace;

    const rootStyle = useMemo((): React.CSSProperties => {
        const base: React.CSSProperties = {
            minWidth: 280,
            borderRadius: 8,
            border: '1px solid var(--studio-border, #363650)',
            background: 'var(--studio-bg-elevated, #262637)',
            fontSize: 12,
            transition: 'background-color 500ms ease-out, border-color 500ms ease-out, box-shadow 500ms ease-out'
        };

        if (executionStatus === 'running') {
            base.borderColor = 'var(--studio-accent-emerald, #34d399)';
            base.boxShadow = '0 0 0 4px rgba(52, 211, 153, 0.2)';
            base.animation = 'studio-pulse 2s infinite';
        } else if (executionStatus === 'success') {
            base.borderColor = 'var(--studio-accent-emerald, #34d399)';
        } else if (executionStatus === 'failed') {
            base.borderColor = 'var(--studio-accent-rose, #fb7185)';
            base.boxShadow = '0 0 16px rgba(251, 113, 133, 0.3)';
        }

        if (isSelected) {
            base.boxShadow = '0 0 0 2px var(--studio-accent-violet, #a78bfa), 0 0 24px rgba(167, 139, 250, 0.25)';
        }

        return base;
    }, [executionStatus, isSelected]);

    const headerStyle = useMemo((): React.CSSProperties => ({
        borderBottom: '1px solid var(--studio-border-subtle, #2d2d44)',
        background: 'var(--studio-bg-surface, #2a2a3d)',
        borderLeft: `3px solid ${categoryColor.accent}`,
        padding: '8px 12px',
        cursor: 'move'
    }), [categoryColor.accent]);

    const statusBadgeStyle = useMemo((): React.CSSProperties => {
        const base: React.CSSProperties = {
            borderRadius: 4,
            padding: '1px 8px',
            fontSize: 10,
            fontWeight: 500
        };
        if (executionStatus === 'running') {
            base.color = 'var(--studio-accent-emerald, #34d399)';
            base.background = 'var(--studio-accent-emerald-dim, rgba(52, 211, 153, 0.15))';
        } else if (executionStatus === 'success') {
            base.color = 'var(--studio-accent-emerald, #34d399)';
            base.background = 'var(--studio-accent-emerald-dim, rgba(52, 211, 153, 0.15))';
        } else if (executionStatus === 'failed') {
            base.color = 'var(--studio-accent-rose, #fb7185)';
            base.background = 'var(--studio-accent-rose-dim, rgba(251, 113, 133, 0.15))';
        } else {
            base.color = 'var(--studio-text-muted, #5c5c7a)';
            base.background = 'transparent';
        }
        return base;
    }, [executionStatus]);

    const statusLabel = executionStatus === 'success' ? '\u2713 success' : executionStatus;

    return (
        <div className="transform-gpu" style={rootStyle}>
            <div className="dag-node-drag-handle" style={headerStyle}>
                <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold" style={{ color: 'var(--studio-text, #e4e4ef)' }}>
                        {props.data.label}
                    </div>
                    <span style={statusBadgeStyle}>
                        {statusLabel}
                    </span>
                </div>
                <div
                    className="font-mono"
                    style={{ fontSize: 11, color: 'var(--studio-text-muted, #5c5c7a)' }}
                >
                    {props.data.nodeType}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-3">
                <div className="nodrag flex flex-col gap-2">
                    <div
                        className="px-3 text-[11px] font-semibold"
                        style={{ color: 'var(--studio-text-secondary, #8b8ba3)' }}
                    >
                        Inputs
                    </div>
                    {inputs.length === 0 ? (
                        <div
                            className="px-3 text-[11px]"
                            style={{ color: 'var(--studio-text-muted, #5c5c7a)' }}
                        >
                            No inputs
                        </div>
                    ) : (
                        inputs.map((port) => {
                            const inputHandles = port.isList
                                ? (props.data.inputHandlesByPortKey?.[port.key] ?? [buildListPortHandleKey(port.key, 0)])
                                : [port.key];
                            return (
                                <div key={`input-${port.key}`} className="relative flex flex-col gap-1 pr-3">
                                    {inputHandles.map((handleId, handleIndex) => {
                                        const isPendingSlot = port.isList && handleIndex === inputHandles.length - 1;
                                        return (
                                            <div key={`${port.key}:${handleId}`} className="relative pl-6">
                                                <Handle
                                                    type="target"
                                                    position={Position.Left}
                                                    id={handleId}
                                                    isConnectable
                                                    isConnectableStart={false}
                                                    isConnectableEnd
                                                    className="!left-[-1px] !h-3 !w-3"
                                                />
                                                <div className={`leading-tight ${isPendingSlot ? 'opacity-50' : ''}`}>
                                                    <div
                                                        className="text-[10px] font-medium"
                                                        style={{ color: 'var(--studio-text, #e4e4ef)' }}
                                                    >
                                                        {port.label ?? port.key}
                                                        {port.isList ? ` #${handleIndex + 1}` : ''}
                                                    </div>
                                                    <div
                                                        className="text-[9px]"
                                                        style={{ color: 'var(--studio-text-muted, #5c5c7a)' }}
                                                    >
                                                        {port.isList ? handleId : port.key} · {port.type} · {port.required ? 'required' : 'optional'}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div
                                        className="text-[9px]"
                                        style={{ color: 'var(--studio-text-muted, #5c5c7a)' }}
                                    >
                                        {port.key} · {port.type} · {port.required ? 'required' : 'optional'}{port.isList ? ' · list' : ''}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="nodrag flex flex-col gap-2">
                    <div
                        className="px-3 text-right text-[11px] font-semibold"
                        style={{ color: 'var(--studio-text-secondary, #8b8ba3)' }}
                    >
                        Outputs
                    </div>
                    {outputs.length === 0 ? (
                        <div
                            className="px-3 text-right text-[11px]"
                            style={{ color: 'var(--studio-text-muted, #5c5c7a)' }}
                        >
                            No outputs
                        </div>
                    ) : (
                        outputs.map((port) => (
                            <div key={`output-${port.key}`} className="relative pl-3 pr-6 text-right">
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={port.key}
                                    isConnectable
                                    isConnectableStart
                                    isConnectableEnd={false}
                                    className="!right-[-1px] !h-3 !w-3"
                                />
                                <div className="leading-tight">
                                    <div
                                        className="text-[10px] font-medium"
                                        style={{ color: 'var(--studio-text, #e4e4ef)' }}
                                    >
                                        {port.label ?? port.key}
                                    </div>
                                    <div
                                        className="text-[9px]"
                                        style={{ color: 'var(--studio-text-muted, #5c5c7a)' }}
                                    >
                                        {port.key} · {port.type} · {port.required ? 'required' : 'optional'}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
            {latestTrace ? (
                <NodeIoViewer
                    input={latestTrace.input}
                    output={latestTrace.output}
                    assetBaseUrl={props.data.assetBaseUrl}
                />
            ) : NO_TRACE_FALLBACK}
        </div>
    );
}
