/**
 * Simple React-Flow Converter
 * 
 * Purpose: Minimal conversion from Universal Workflow to React-Flow format
 * Principle: Delegate React-Flow native features to React-Flow itself
 */

import type { SimpleLogger } from '../../utils/simple-logger';
import { SilentLogger } from '../../utils/simple-logger';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '../workflow-converter/universal-types';
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge
} from './types';

/**
 * Simple React-Flow Converter
 * 
 * Features:
 * - Pure Universal → React-Flow data transformation
 * - No layout calculation (delegate to React-Flow)
 * - No styling (delegate to React-Flow CSS)
 * - No interaction control (delegate to React-Flow props)
 * - No metadata processing (pass through to data)
 */
export class SimpleReactFlowConverter {
    private readonly logger: SimpleLogger;

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    /**
     * Convert Universal Workflow Structure to React-Flow Data
     * Simple 1:1 transformation with React-Flow responsibility delegation
     */
    convert(input: UniversalWorkflowStructure): ReactFlowData {
        this.logger.debug('Converting Universal workflow to React-Flow', {
            nodeCount: input.nodes.length,
            edgeCount: input.edges.length
        });

        return {
            nodes: this.convertNodes(input.nodes),
            edges: this.convertEdges(input.edges)
        };
    }

    /**
     * Convert Universal nodes to React-Flow nodes
     * Minimal transformation - let React-Flow handle the rest
     */
    private convertNodes(universalNodes: UniversalWorkflowNode[]): ReactFlowNode[] {
        return universalNodes.map(node => ({
            id: node.id,
            type: node.type,
            position: {
                x: node.position.x || 0,
                y: node.position.y || 0
            },
            data: {
                // Pass through all node data - let React-Flow handle it
                ...node.data,
                // Ensure label exists
                label: node.data.label || node.id
            }
        }));
    }

    /**
     * Convert Universal edges to React-Flow edges  
     * Minimal transformation - let React-Flow handle the rest
     */
    private convertEdges(universalEdges: UniversalWorkflowEdge[]): ReactFlowEdge[] {
        return universalEdges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: edge.type,
            data: {
                // Pass through all edge data - let React-Flow handle it
                ...edge.data
            }
        }));
    }
}

// For backward compatibility
export const UniversalToReactFlowConverter = SimpleReactFlowConverter;