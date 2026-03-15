import { useMemo, useState, type ReactElement } from 'react';
import type { INodeManifest, INodeObjectInfo, TObjectInfo } from '@robota-sdk/dag-core';

export interface INodeExplorerPanelProps {
    manifests: INodeManifest[];
    objectInfo?: TObjectInfo;
    onAddNode: (manifest: INodeManifest) => void;
    onAddNodeFromObjectInfo?: (nodeType: string, info: INodeObjectInfo) => void;
    className?: string;
}

interface ICatalogEntry {
    nodeType: string;
    displayName: string;
    category: string;
    source: 'manifest' | 'objectInfo';
    manifest?: INodeManifest;
    objectInfo?: INodeObjectInfo;
}

export function NodeExplorerPanel(props: INodeExplorerPanelProps): ReactElement {
    const useObjectInfo = Boolean(props.objectInfo && Object.keys(props.objectInfo).length > 0);

    const categoryMap = useMemo(() => {
        const map = new Map<string, ICatalogEntry[]>();
        if (useObjectInfo && props.objectInfo) {
            for (const [nodeType, info] of Object.entries(props.objectInfo)) {
                const entry: ICatalogEntry = {
                    nodeType,
                    displayName: info.display_name,
                    category: info.category,
                    source: 'objectInfo',
                    objectInfo: info,
                };
                const current = map.get(info.category) ?? [];
                current.push(entry);
                map.set(info.category, current);
            }
        } else {
            for (const manifest of props.manifests) {
                if (manifest.deprecated) {
                    continue;
                }
                const entry: ICatalogEntry = {
                    nodeType: manifest.nodeType,
                    displayName: manifest.displayName,
                    category: manifest.category,
                    source: 'manifest',
                    manifest,
                };
                const current = map.get(manifest.category) ?? [];
                current.push(entry);
                map.set(manifest.category, current);
            }
        }
        return map;
    }, [props.manifests, props.objectInfo, useObjectInfo]);

    const categories = useMemo(
        () => [...categoryMap.keys()].sort((left, right) => left.localeCompare(right)),
        [categoryMap]
    );
    const [rawActiveCategory, setActiveCategory] = useState<string>(categories[0] ?? '');
    const activeCategory = categories.includes(rawActiveCategory) ? rawActiveCategory : (categories[0] ?? '');

    const visibleEntries = categoryMap.get(activeCategory) ?? [];

    const handleAddNode = (entry: ICatalogEntry): void => {
        if (entry.source === 'objectInfo' && entry.objectInfo && props.onAddNodeFromObjectInfo) {
            props.onAddNodeFromObjectInfo(entry.nodeType, entry.objectInfo);
        } else if (entry.source === 'manifest' && entry.manifest) {
            props.onAddNode(entry.manifest);
        }
    };

    return (
        <div className={`flex h-full flex-col rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] ${props.className ?? ''}`}>
            <h2 className="px-2 pt-2 text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Node Explorer</h2>
            <div className="flex border-b border-[var(--studio-border)]" role="tablist" aria-label="Node Explorer categories">
                {categories.map((category) => {
                    const isActive = activeCategory === category;
                    return (
                        <button
                            key={category}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`relative flex-1 px-1 py-1.5 text-xs text-center transition-all ${
                                isActive
                                    ? 'text-[var(--studio-accent-violet)]'
                                    : 'text-[var(--studio-text-muted)] hover:text-[var(--studio-text-secondary)]'
                            }`}
                            onClick={() => setActiveCategory(category)}
                        >
                            {category}
                            <span className={`ml-1 text-[10px] ${
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
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-3">
                {visibleEntries.map((entry) => (
                    <button
                        key={entry.nodeType}
                        type="button"
                        className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-left text-sm transition-all hover:border-[var(--studio-accent-violet)] hover:shadow-[0_0_6px_var(--studio-accent-violet-dim)]"
                        onClick={() => handleAddNode(entry)}
                    >
                        <div className="font-medium text-[var(--studio-text)]">{entry.displayName}</div>
                        <div className="text-xs text-[var(--studio-text-muted)]">{entry.nodeType}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}
