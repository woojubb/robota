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
        <section className="rounded border border-gray-200 p-2">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold">{title}</h3>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{ports.length}</span>
                </div>
            </div>

            <div className="space-y-2">
                {ports.length === 0 ? (
                    <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">
                        No ports defined in this node type.
                    </div>
                ) : ports.map((port, index) => {
                    const connectedCount = getConnectedCount(direction, port.key);

                    return (
                        <article key={`${direction}-${index}-${port.key}`} className="rounded border border-gray-200 p-2">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium">Port {index + 1}</span>
                                <span className="text-[11px] text-gray-500">
                                    Connected bindings: {connectedCount}
                                </span>
                            </div>

                            <div className="grid grid-cols-12 items-center gap-2">
                                <label className="col-span-4 text-xs font-medium text-gray-700">Label</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {port.label ?? '-'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-xs font-medium text-gray-700">Key</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {port.key}
                                    </div>
                                </div>

                                <label className="col-span-4 text-xs font-medium text-gray-700">Type</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {port.type}
                                    </div>
                                </div>

                                <label className="col-span-4 text-xs font-medium text-gray-700">Required</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {port.required ? 'Required' : 'Optional'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-xs font-medium text-gray-700">Order</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {typeof port.order === 'number' ? port.order : '-'}
                                    </div>
                                </div>

                                <label className="col-span-4 text-xs font-medium text-gray-700">Description</label>
                                <div className="col-span-8">
                                    <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                        {port.description ?? '-'}
                                    </div>
                                </div>

                                {port.type === 'binary' ? (
                                    <>
                                        <label className="col-span-4 text-xs font-medium text-gray-700">Binary Kind</label>
                                        <div className="col-span-8">
                                            <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                                {port.binaryKind ?? '-'}
                                            </div>
                                        </div>

                                        <label className="col-span-4 text-xs font-medium text-gray-700">Mime Types</label>
                                        <div className="col-span-8">
                                            <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
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
