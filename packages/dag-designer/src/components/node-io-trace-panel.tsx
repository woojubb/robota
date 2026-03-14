import type { ReactElement } from 'react';
import type { IDagNodeIoTrace } from './dag-node-view.js';
import type { TNodeExecutionStatus } from './dag-designer-canvas.js';

export interface INodeIoTracePanelProps {
    traces: IDagNodeIoTrace[];
    selectedNodeId?: string;
    selectedNodeExecutionStatus?: TNodeExecutionStatus;
    className?: string;
}

function stringifyPayload(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function NodeIoTracePanel(props: INodeIoTracePanelProps): ReactElement {
    const traces = props.traces;
    let selectedTrace = undefined as IDagNodeIoTrace | undefined;
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
        <section className={`rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] p-3 ${props.className ?? ''}`}>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Node I/O Trace</h2>
                <span className="rounded-md bg-[var(--studio-bg-surface)] px-2 py-0.5 text-[11px] text-[var(--studio-text-muted)]">
                    {traces.length} trace(s)
                </span>
            </div>
            {traces.length === 0 ? (
                <p className="text-xs text-[var(--studio-text-muted)]">Run to inspect node input/output payloads.</p>
            ) : null}

            {selectedTrace ? (
                <div className="space-y-2 text-xs">
                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1">
                        <div className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Selected Node</div>
                        <div className="font-mono text-[var(--studio-text-secondary)]">{selectedTrace.nodeId}</div>
                        <div className="text-[var(--studio-text-muted)]">
                            status={props.selectedNodeExecutionStatus ?? 'idle'}
                        </div>
                    </div>
                    <div>
                        <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Input</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2 font-mono text-[11px] text-[var(--studio-text-secondary)]">
                            {stringifyPayload(selectedTrace.input)}
                        </pre>
                    </div>
                    <div>
                        <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Output</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2 font-mono text-[11px] text-[var(--studio-text-secondary)]">
                            {stringifyPayload(selectedTrace.output)}
                        </pre>
                    </div>
                </div>
            ) : null}

            {!selectedTrace && traces.length > 0 ? (
                <div className="space-y-1 text-xs">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Latest Traces</div>
                    {traces.map((trace) => (
                        <div key={trace.nodeId} className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-[var(--studio-text-secondary)]">
                            <span className="font-mono">{trace.nodeId}</span> - output keys: {Object.keys(trace.output ?? {}).join(', ') || '(none)'}
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
