import { useMemo, useState, type ReactElement } from 'react';
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
    const [rawActiveCategory, setActiveCategory] = useState<string>(categories[0] ?? '');
    const activeCategory = categories.includes(rawActiveCategory) ? rawActiveCategory : (categories[0] ?? '');

    const visibleManifests = categoryMap.get(activeCategory) ?? [];

    return (
        <div className={`flex h-full flex-col gap-3 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] p-3 ${props.className ?? ''}`}>
            <h2 className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Node Explorer</h2>
            <div className="flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Node Explorer categories">
                {categories.map((category) => {
                    const isActive = activeCategory === category;
                    return (
                        <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`rounded-md px-3 py-1 text-xs transition-all ${
                                isActive
                                    ? 'bg-[var(--studio-accent-violet)] text-white shadow-[0_0_8px_var(--studio-accent-violet-dim)]'
                                    : 'bg-[var(--studio-bg-surface)] text-[var(--studio-text-muted)] hover:bg-[var(--studio-bg-surface)] hover:text-[var(--studio-text-secondary)]'
                            }`}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
                                isActive ? 'bg-white/20 text-white' : 'bg-[var(--studio-bg-elevated)] text-[var(--studio-text-muted)]'
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
                        className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-left text-xs transition-all hover:border-[var(--studio-accent-violet)] hover:shadow-[0_0_6px_var(--studio-accent-violet-dim)]"
                        onClick={() => props.onAddNode(manifest)}
                    >
                        <div className="font-medium text-[var(--studio-text)]">{manifest.displayName}</div>
                        <div className="text-[11px] text-[var(--studio-text-muted)]">{manifest.nodeType}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}
