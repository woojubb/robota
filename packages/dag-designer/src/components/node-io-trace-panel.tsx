import type { ReactElement } from 'react';
import type { IPreviewResult } from '../lifecycle/preview-engine.js';

export interface INodeIoTracePanelProps {
    previewResult?: IPreviewResult;
    selectedNodeId?: string;
    className?: string;
}

function stringifyPayload(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function NodeIoTracePanel(props: INodeIoTracePanelProps): ReactElement {
    const traces = props.previewResult?.traces ?? [];
    let selectedTrace = undefined as IPreviewResult['traces'][number] | undefined;
    if (typeof props.selectedNodeId === 'string') {
        for (let index = traces.length - 1; index >= 0; index -= 1) {
            const trace = traces[index];
            if (trace.nodeId === props.selectedNodeId) {
                selectedTrace = trace;
                break;
            }
        }
    }

    return (
        <section className={`rounded border border-gray-300 p-3 ${props.className ?? ''}`}>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Node I/O Trace</h2>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {traces.length} trace(s)
                </span>
            </div>
            {!props.previewResult ? (
                <p className="text-xs text-gray-500">Run Preview to inspect node input/output payloads.</p>
            ) : null}
            {props.previewResult && traces.length === 0 ? (
                <p className="text-xs text-gray-500">No trace data available.</p>
            ) : null}

            {selectedTrace ? (
                <div className="space-y-2 text-xs">
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
                        <div className="font-medium">Selected Node</div>
                        <div>{selectedTrace.nodeId} ({selectedTrace.nodeType})</div>
                        <div>
                            estimatedCostUsd={selectedTrace.estimatedCostUsd.toFixed(6)} / totalCostUsd={selectedTrace.totalCostUsd.toFixed(6)}
                        </div>
                    </div>
                    <div>
                        <div className="mb-1 font-medium text-gray-700">Input</div>
                        <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                            {stringifyPayload(selectedTrace.input)}
                        </pre>
                    </div>
                    <div>
                        <div className="mb-1 font-medium text-gray-700">Output</div>
                        <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                            {stringifyPayload(selectedTrace.output)}
                        </pre>
                    </div>
                </div>
            ) : null}

            {!selectedTrace && traces.length > 0 ? (
                <div className="space-y-1 text-xs">
                    <div className="font-medium text-gray-700">Latest Traces</div>
                    {traces.map((trace) => (
                        <div key={`${trace.nodeId}:${trace.nodeType}`} className="rounded border border-gray-200 px-2 py-1">
                            {trace.nodeId} ({trace.nodeType}) - output keys: {Object.keys(trace.output).join(', ') || '(none)'}
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
