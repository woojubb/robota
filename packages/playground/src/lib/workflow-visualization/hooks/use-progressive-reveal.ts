import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Simple Progressive Reveal Configuration
 */
export interface ProgressiveRevealConfig {
    enabled: boolean;
    intervalMs: number;
    bundleSize: number;
}

/**
 * Simple Progressive Reveal State
 */
export interface ProgressiveRevealState<TNode, TEdge> {
    visibleNodes: TNode[];
    visibleEdges: TEdge[];
    currentIndex: number;
    totalCount: number;
    isComplete: boolean;
}

/**
 * Incremental Progressive Reveal State
 */
export interface IncrementalProgressiveRevealState<TNode, TEdge> {
    /** Action to perform: 'add_node', 'add_edge', 'complete', 'init' */
    action: 'add_node' | 'add_edge' | 'complete' | 'init';
    /** Node to add (if action is 'add_node') */
    nodeToAdd?: TNode;
    /** Edges to add (if action is 'add_edge') */
    edgesToAdd?: TEdge[];
    /** Current progress info */
    currentIndex: number;
    totalCount: number;
    isComplete: boolean;
}

/**
 * Incremental Progressive Reveal Hook
 * Returns incremental updates instead of full arrays to avoid re-rendering all nodes
 */
export function useProgressiveReveal<TNode extends { id: string }, TEdge extends { source: string; target: string }>(
    allNodes: TNode[],
    allEdges: TEdge[],
    config: ProgressiveRevealConfig
): IncrementalProgressiveRevealState<TNode, TEdge> {

    const [currentIndex, setCurrentIndex] = useState(0);
    const [lastProcessedIndex, setLastProcessedIndex] = useState(-1);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const totalCount = allNodes.length;
    const isComplete = currentIndex >= totalCount - 1;

    // Determine what action to take
    const actionData = useMemo((): IncrementalProgressiveRevealState<TNode, TEdge> => {
        if (!config.enabled || totalCount === 0) {
            return {
                action: 'init',
                currentIndex: totalCount - 1,
                totalCount,
                isComplete: true
            };
        }

        // If we've moved to a new index, add the new node
        if (currentIndex > lastProcessedIndex && currentIndex < totalCount) {
            const nodeToAdd = allNodes[currentIndex];

            // Find edges that can now be displayed
            const visibleNodeIds = new Set(allNodes.slice(0, currentIndex + 1).map(n => n.id));
            const newEdges = allEdges.filter(edge => {
                return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
            });

            // Find edges that weren't visible before
            const previouslyVisibleNodeIds = new Set(allNodes.slice(0, currentIndex).map(n => n.id));
            const previouslyVisibleEdges = allEdges.filter(edge => {
                return previouslyVisibleNodeIds.has(edge.source) && previouslyVisibleNodeIds.has(edge.target);
            });

            // Edge identity: if the edge provides an id, use it; otherwise fall back to (source,target) pair
            const edgeKey = (edge: TEdge): string => {
                const maybeEdgeId = (edge as { id?: string }).id;
                return typeof maybeEdgeId === 'string' ? maybeEdgeId : `${edge.source}→${edge.target}`;
            };

            const previousKeys = new Set(previouslyVisibleEdges.map(edgeKey));
            const edgesToAdd = newEdges.filter(edge => !previousKeys.has(edgeKey(edge)));

            return {
                action: 'add_node',
                nodeToAdd,
                edgesToAdd: edgesToAdd.length > 0 ? edgesToAdd : undefined,
                currentIndex,
                totalCount,
                isComplete: currentIndex >= totalCount - 1
            };
        }

        // If we're complete
        if (isComplete) {
            return {
                action: 'complete',
                currentIndex,
                totalCount,
                isComplete: true
            };
        }

        // No action needed
        return {
            action: 'init',
            currentIndex,
            totalCount,
            isComplete
        };
    }, [allNodes, allEdges, currentIndex, lastProcessedIndex, config.enabled, totalCount, isComplete]);

    // Update last processed index when we return an add_node action
    useEffect(() => {
        if (actionData.action === 'add_node') {
            setLastProcessedIndex(currentIndex);
        }
    }, [actionData.action, currentIndex]);

    // Auto-progression effect
    useEffect(() => {
        if (!config.enabled || totalCount === 0 || isComplete) {
            return;
        }

        timerRef.current = setTimeout(() => {
            setCurrentIndex(prev => Math.min(prev + config.bundleSize, totalCount - 1));
        }, config.intervalMs);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [currentIndex, config.enabled, config.intervalMs, config.bundleSize, totalCount, isComplete]);

    // Reset when nodes change significantly
    useEffect(() => {
        setCurrentIndex(0);
        setLastProcessedIndex(-1);
    }, [totalCount]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, []);

    return actionData;
}

/**
 * Default Configuration
 */
export const DEFAULT_PROGRESSIVE_REVEAL_CONFIG: ProgressiveRevealConfig = {
    enabled: true,
    intervalMs: 500,
    bundleSize: 1
};
