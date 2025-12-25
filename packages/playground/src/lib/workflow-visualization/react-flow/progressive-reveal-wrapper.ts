import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
    useProgressiveReveal,
    type IProgressiveRevealConfig,
    type IIncrementalProgressiveRevealState,
    DEFAULT_PROGRESSIVE_REVEAL_CONFIG
} from '../hooks/use-progressive-reveal';

/**
 * React Flow Progressive Reveal Configuration
 */
export interface IReactFlowProgressiveRevealConfig extends IProgressiveRevealConfig {
    // No additional properties for now - keep it simple
}

/**
 * React Flow Progressive Reveal Props
 */
export interface IReactFlowProgressiveRevealProps {
    nodes: Node[];
    edges: Edge[];
    config?: Partial<IReactFlowProgressiveRevealConfig>;
    onNodeRevealed?: (node: Node) => void;
}

/**
 * Default React Flow Progressive Reveal Configuration
 */
export const DEFAULT_REACT_FLOW_PROGRESSIVE_REVEAL_CONFIG: IReactFlowProgressiveRevealConfig = {
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
}: IReactFlowProgressiveRevealProps): IIncrementalProgressiveRevealState<Node, Edge> {

    // Merge with default config
    const fullConfig = useMemo(() => ({
        ...DEFAULT_REACT_FLOW_PROGRESSIVE_REVEAL_CONFIG,
        ...config
    }), [config]);

    // Use base progressive reveal hook
    const result = useProgressiveReveal(nodes, edges, fullConfig);

    return result;
}


