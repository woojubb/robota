import type { ReactElement } from 'react';
import type { IPortDefinition } from '@robota-sdk/dag-core';
import type { TPortDirection } from './port-editor-utils.js';

export interface IPortSectionProps {
    direction: TPortDirection;
    ports: IPortDefinition[];
    getConnectedCount: (direction: TPortDirection, portKey: string) => number;
}

export function PortSection(props: IPortSectionProps): ReactElement {
    const { direction, ports, getConnectedCount } = props;
    const title = direction === 'inputs' ? 'Inputs' : 'Outputs';
    return (
        <section className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h3 className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">{title}</h3>
                    <span className="rounded-md bg-[var(--studio-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--studio-text-muted)]">{ports.length}</span>
                </div>
            </div>

            <div className="space-y-2">
                {ports.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--studio-border)] p-3 text-xs text-[var(--studio-text-muted)]">
                        No ports defined in this node type.
                    </div>
                ) : ports.map((port, index) => {
                    const connectedCount = getConnectedCount(direction, port.key);

                    return (
                        <article key={`${direction}-${index}-${port.key}`} className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] p-2">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium text-[var(--studio-text)]">Port {index + 1}</span>
                                <span className="text-[11px] text-[var(--studio-text-muted)]">
                                    Connected bindings: {connectedCount}
                                </span>
                            </div>

                            <div className="grid grid-cols-12 items-center gap-2">
                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Label</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                        {port.label ?? '-'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Key</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 font-mono text-xs text-[var(--studio-text-secondary)]">
                                        {port.key}
                                    </div>
                                </div>

                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Type</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                        {port.type}
                                    </div>
                                </div>

                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Required</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                        {port.required ? 'Required' : 'Optional'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Order</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                        {typeof port.order === 'number' ? port.order : '-'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Description</label>
                                <div className="col-span-8">
                                    <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                        {port.description ?? '-'}
                                    </div>
                                </div>

                                {port.type === 'binary' ? (
                                    <>
                                        <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Binary Kind</label>
                                        <div className="col-span-8">
                                            <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                                {port.binaryKind ?? '-'}
                                            </div>
                                        </div>

                                        <label className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Mime Types</label>
                                        <div className="col-span-8">
                                            <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
                                                {Array.isArray(port.mimeTypes) && port.mimeTypes.length > 0 ? port.mimeTypes.join(', ') : '-'}
                                            </div>
                                        </div>
                                    </>
                                ) : null}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
