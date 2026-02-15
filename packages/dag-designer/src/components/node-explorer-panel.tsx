import type { ReactElement } from 'react';
import type { INodeManifest } from '@robota-sdk/dag-core';

export interface INodeExplorerPanelProps {
    manifests: INodeManifest[];
    onAddNode: (manifest: INodeManifest) => void;
}

export function NodeExplorerPanel(props: INodeExplorerPanelProps): ReactElement {
    const categories = [...new Set(props.manifests.map((manifest) => manifest.category))];

    return (
        <div className="flex h-full flex-col gap-3 rounded border border-gray-300 p-3">
            <h2 className="text-sm font-semibold">Node Explorer</h2>
            <div className="flex flex-col gap-3 overflow-y-auto">
                {categories.map((category) => (
                    <section key={category} className="flex flex-col gap-2">
                        <h3 className="text-xs font-medium uppercase text-gray-500">{category}</h3>
                        <div className="flex flex-col gap-2">
                            {props.manifests
                                .filter((manifest) => manifest.category === category && !manifest.deprecated)
                                .map((manifest) => (
                                    <button
                                        key={manifest.nodeType}
                                        type="button"
                                        className="rounded border border-gray-300 px-3 py-2 text-left text-xs hover:bg-gray-50"
                                        onClick={() => props.onAddNode(manifest)}
                                    >
                                        <div className="font-medium">{manifest.displayName}</div>
                                        <div className="text-[11px] text-gray-500">{manifest.nodeType}</div>
                                    </button>
                                ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
