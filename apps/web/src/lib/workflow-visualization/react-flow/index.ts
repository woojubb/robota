/**
 * Simple React-Flow Converter
 * 
 * Purpose: Minimal conversion from Universal Workflow to React-Flow format
 * Principle: Delegate React-Flow native features to React-Flow itself
 */

import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

// SimpleLogger interface for internal use
interface SimpleLogger {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
}
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge
} from './types';

/**
 * SDK to React-Flow Node Type Mapping
 * Maps Universal Workflow node types to React-Flow custom node types
 */
const SDK_TO_REACTFLOW_TYPE_MAP: Record<string, string> = {
    'tool_call': 'toolCall',
    'agent_thinking': 'agent',
    'final_response': 'agentResponse',
    'sub_agent': 'agent',
    'user_input': 'userInput',
    'merge_results': 'agentResponse',
    'agent': 'agent',
    'team': 'team',
    'tool': 'tool',
    'output': 'agentResponse'
};

/**
 * Simple React-Flow Converter
 * 
 * Features:
 * - Pure Universal → React-Flow data transformation
 * - SDK node type mapping to React-Flow custom types
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
    async convert(universal: UniversalWorkflowStructure): Promise<ReactFlowData> {
        this.logger.debug('Converting Universal Workflow to React-Flow format');

        try {
            const nodes = this.convertNodes(universal.nodes);
            const edges = this.convertEdges(universal.edges);

            return {
                nodes,
                edges
            };
        } catch (error) {
            this.logger.error('Conversion failed:', error);
            throw new Error(`React-Flow conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Convert Universal nodes to React-Flow nodes
     * Pure data transformation with SDK type mapping - styling delegated to React-Flow
     */
    private convertNodes(universalNodes: UniversalWorkflowNode[]): ReactFlowNode[] {
        return universalNodes.map(universalNode => {
            // Map SDK node type to React-Flow custom node type
            const mappedType = SDK_TO_REACTFLOW_TYPE_MAP[universalNode.type] || universalNode.type || 'default';

            this.logger.debug(`Converting node ${universalNode.id}: ${universalNode.type} → ${mappedType}`);

            return {
                id: universalNode.id,
                type: mappedType,
                position: {
                    x: universalNode.position?.x || 0,
                    y: universalNode.position?.y || 0
                },
                data: {
                    label: universalNode.data.label || `${universalNode.type} ${universalNode.id}`,
                    // Pass through all Universal data
                    ...universalNode.data,
                    // Include original SDK type for reference
                    originalType: universalNode.type,
                    // Include visual state for reference
                    visualState: universalNode.visualState,
                    // Include metadata for reference
                    metadata: universalNode.metadata
                }
            };
        });
    }

    /**
     * Convert Universal edges to React-Flow edges
     * Pure data transformation - styling delegated to React-Flow
     */
    private convertEdges(universalEdges: UniversalWorkflowEdge[]): ReactFlowEdge[] {
        return universalEdges.map(universalEdge => ({
            id: universalEdge.id,
            source: universalEdge.source,
            target: universalEdge.target,
            type: 'default',
            data: {
                // Generate basic label from source/target
                label: `${universalEdge.source} → ${universalEdge.target}`,
                // Pass through all Universal data
                ...universalEdge.data,
                // Include metadata for reference
                metadata: universalEdge.metadata
            }
        }));
    }
}

// Legacy alias for backward compatibility (if needed)
export const UniversalToReactFlowConverter = SimpleReactFlowConverter;