import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { INodeManifest } from '@robota-sdk/dag-core';

export interface INodeExplorerPanelProps {
    manifests: INodeManifest[];
    onAddNode: (manifest: INodeManifest) => void;
    className?: string;
}

export function NodeExplorerPanel(props: INodeExplorerPanelProps): ReactElement {
    const categoryMap = useMemo(() => {
        const map = new Map<string, INodeManifest[]>();
        for (const manifest of props.manifests) {
            if (manifest.deprecated) {
                continue;
            }
            const current = map.get(manifest.category) ?? [];
            current.push(manifest);
            map.set(manifest.category, current);
        }
        return map;
    }, [props.manifests]);

    const categories = useMemo(
        () => [...categoryMap.keys()].sort((left, right) => left.localeCompare(right)),
        [categoryMap]
    );
    const [activeCategory, setActiveCategory] = useState<string>(categories[0] ?? '');

    useEffect(() => {
        const nextCategory = categories[0] ?? '';
        if (!categories.includes(activeCategory)) {
            setActiveCategory(nextCategory);
        }
    }, [activeCategory, categories]);

    const visibleManifests = categoryMap.get(activeCategory) ?? [];

    return (
        <div className={`flex h-full flex-col gap-3 rounded border border-gray-300 p-3 ${props.className ?? ''}`}>
            <h2 className="text-sm font-semibold">Node Explorer</h2>
            <div className="flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Node Explorer categories">
                {categories.map((category) => {
                    const isActive = activeCategory === category;
                    return (
                        <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`rounded border px-3 py-1 text-xs transition-colors ${
                                isActive
                                    ? 'border-gray-900 bg-gray-900 text-white'
                                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                                isActive ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'
                            }`}
                            >
                                {(categoryMap.get(category) ?? []).length}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                {visibleManifests.map((manifest) => (
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
        </div>
    );
}
