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
        <div className={`flex h-full flex-col rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] ${props.className ?? ''}`}>
            <h2 className="px-2 pt-2 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">Node Explorer</h2>
            <div className="flex border-b border-[var(--studio-border)]" role="tablist" aria-label="Node Explorer categories">
                {categories.map((category) => {
                    const isActive = activeCategory === category;
                    return (
                        <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`relative flex-1 px-1 py-1.5 text-[11px] text-center transition-all ${
                                isActive
                                    ? 'text-[var(--studio-accent-violet)]'
                                    : 'text-[var(--studio-text-muted)] hover:text-[var(--studio-text-secondary)]'
                            }`}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                            <span className={`ml-1 text-[9px] ${
                                isActive ? 'text-[var(--studio-accent-violet)]' : 'text-[var(--studio-text-muted)]'
                            }`}
                            >
                                {(categoryMap.get(category) ?? []).length}
                            </span>
                            {isActive ? (
                                <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[var(--studio-accent-violet)]" />
                            ) : null}
                        </button>
                    );
                })}
            </div>
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
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
