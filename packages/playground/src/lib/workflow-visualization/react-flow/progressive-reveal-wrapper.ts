import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
    useProgressiveReveal,
    type ProgressiveRevealConfig,
    type IncrementalProgressiveRevealState,
    DEFAULT_PROGRESSIVE_REVEAL_CONFIG
} from '../hooks/use-progressive-reveal';

/**
 * React Flow Progressive Reveal Configuration
 */
export interface ReactFlowProgressiveRevealConfig extends ProgressiveRevealConfig {
    // No additional properties for now - keep it simple
}

/**
 * React Flow Progressive Reveal Props
 */
export interface ReactFlowProgressiveRevealProps {
    nodes: Node[];
    edges: Edge[];
    config?: Partial<ReactFlowProgressiveRevealConfig>;
    onNodeRevealed?: (node: Node) => void;
}

/**
 * Default React Flow Progressive Reveal Configuration
 */
export const DEFAULT_REACT_FLOW_PROGRESSIVE_REVEAL_CONFIG: ReactFlowProgressiveRevealConfig = {
    ...DEFAULT_PROGRESSIVE_REVEAL_CONFIG
};

/**
 * Incremental React Flow Progressive Reveal Hook
 * Returns incremental actions instead of full node/edge arrays
 */
export function useReactFlowProgressiveReveal({
    nodes,
    edges,
    config = {}
}: ReactFlowProgressiveRevealProps): IncrementalProgressiveRevealState<Node, Edge> {

    // Merge with default config
    const fullConfig = useMemo(() => ({
        ...DEFAULT_REACT_FLOW_PROGRESSIVE_REVEAL_CONFIG,
        ...config
    }), [config]);

    // Use base progressive reveal hook
    const result = useProgressiveReveal(nodes, edges, fullConfig);

    return result;
}


