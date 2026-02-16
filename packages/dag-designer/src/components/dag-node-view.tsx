import type { ReactElement } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { IPortDefinition } from '@robota-sdk/dag-core';
import type { TNodeExecutionStatus } from './dag-designer-canvas.js';

export interface IDagNodeViewData extends Record<string, unknown> {
    label: string;
    nodeType: string;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    executionStatus?: TNodeExecutionStatus;
}

export type TDagCanvasNode = Node<IDagNodeViewData, 'dag-node'>;

function sortPorts(ports: IPortDefinition[]): IPortDefinition[] {
    return [...ports].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
}

export function DagNodeView(props: NodeProps<TDagCanvasNode>): ReactElement {
    const inputs = sortPorts(props.data.inputs);
    const outputs = sortPorts(props.data.outputs);
    const executionStatus = props.data.executionStatus ?? 'idle';
    const statusRootClassName = executionStatus === 'running'
        ? 'border-blue-500 bg-blue-50/95'
        : executionStatus === 'success'
            ? 'border-emerald-500 bg-emerald-50/95'
            : executionStatus === 'failed'
                ? 'border-red-500 bg-red-50/95'
                : 'border-gray-300 bg-white';
    const selectedRingClassName = props.selected
        ? 'ring-2 ring-blue-300 shadow-md'
        : 'shadow-sm';
    const rootClassName = [
        'min-w-[280px] rounded border text-xs transform-gpu',
        'transition-[background-color,border-color,box-shadow,transform] duration-500 ease-out',
        statusRootClassName,
        selectedRingClassName
    ].join(' ');
    const headerClassName = [
        'dag-node-drag-handle cursor-move border-b px-3 py-2',
        executionStatus === 'running'
            ? 'border-blue-300 bg-blue-100/70'
            : executionStatus === 'success'
                ? 'border-emerald-300 bg-emerald-100/70'
                : executionStatus === 'failed'
                    ? 'border-red-300 bg-red-100/70'
                    : props.selected
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-300 bg-gray-50'
    ].join(' ');
    const executionStatusClassName = 'bg-transparent text-gray-700';

    return (
        <div className={rootClassName}>
            <div className={headerClassName}>
                <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{props.data.label}</div>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${executionStatusClassName}`}>
                        {executionStatus}
                    </span>
                </div>
                <div className="text-[11px] text-gray-500">{props.data.nodeType}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 py-3">
                <div className="nodrag flex flex-col gap-2">
                    <div className="px-3 text-[11px] font-semibold text-gray-600">Inputs</div>
                    {inputs.length === 0 ? (
                        <div className="px-3 text-[11px] text-gray-400">No inputs</div>
                    ) : (
                        inputs.map((port) => (
                            <div key={`input-${port.key}`} className="relative px-3 pl-6">
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={port.key}
                                    isConnectable
                                    isConnectableStart={false}
                                    isConnectableEnd
                                    className="!h-3 !w-3"
                                />
                                <div className="leading-tight">
                                    <div className="text-[10px] font-medium text-gray-700">{port.label ?? port.key}</div>
                                    <div className="text-[9px] text-gray-500">
                                        {port.key} · {port.type} · {port.required ? 'required' : 'optional'}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="nodrag flex flex-col gap-2">
                    <div className="px-3 text-right text-[11px] font-semibold text-gray-600">Outputs</div>
                    {outputs.length === 0 ? (
                        <div className="px-3 text-right text-[11px] text-gray-400">No outputs</div>
                    ) : (
                        outputs.map((port) => (
                            <div key={`output-${port.key}`} className="relative px-3 pr-6 text-right">
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={port.key}
                                    isConnectable
                                    isConnectableStart
                                    isConnectableEnd={false}
                                    className="!h-3 !w-3"
                                />
                                <div className="leading-tight">
                                    <div className="text-[10px] font-medium text-gray-700">{port.label ?? port.key}</div>
                                    <div className="text-[9px] text-gray-500">
                                        {port.key} · {port.type} · {port.required ? 'required' : 'optional'}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
