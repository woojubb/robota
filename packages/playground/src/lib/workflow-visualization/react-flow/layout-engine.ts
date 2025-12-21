/**
 * Simple React-Flow Layout Helper
 * 
 * Purpose: Minimal layout assistance for React-Flow positioning
 * Principle: Basic positioning only - let React-Flow handle complex layouts
 */

import type { 
    UniversalWorkflowNode
} from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

// SimpleLogger interface for internal use
interface SimpleLogger {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
}

/**
 * Simple layout options
 */
export interface SimpleLayoutOptions {
    nodeSpacing?: number;
    levelSpacing?: number;
}

/**
 * Simple React-Flow Layout Helper
 * 
 * Features:
 * - Basic hierarchical positioning only
 * - No complex algorithms (delegate to React-Flow/dagre)
 * - Minimal configuration
 */
export class SimpleReactFlowLayoutHelper {
    private readonly logger: SimpleLogger;

    constructor(logger: SimpleLogger = SilentLogger) {
        this.logger = logger;
    }

    /**
     * Calculate simple hierarchical positions
     * For complex layouts, use React-Flow's built-in layout libraries
     */
    calculateSimpleLayout(
        nodes: UniversalWorkflowNode[], 
        options: SimpleLayoutOptions = {}
    ): UniversalWorkflowNode[] {
        const nodeSpacing = options.nodeSpacing || 150;
        const levelSpacing = options.levelSpacing || 100;

        // Group nodes by level
        const levelGroups = new Map<number, UniversalWorkflowNode[]>();
        nodes.forEach(node => {
            const level = node.level || 0;
            if (!levelGroups.has(level)) {
                levelGroups.set(level, []);
            }
            levelGroups.get(level)!.push(node);
        });

        // Simple positioning: spread nodes horizontally by level
        const positionedNodes: UniversalWorkflowNode[] = [];
        
        for (const [level, levelNodes] of levelGroups.entries()) {
            const startX = -(levelNodes.length - 1) * nodeSpacing / 2;
            
            levelNodes.forEach((node, index) => {
                positionedNodes.push({
                    ...node,
                    position: {
                        ...node.position,
                        x: startX + (index * nodeSpacing),
                        y: level * levelSpacing
                    }
                });
            });
        }

        this.logger.debug('Simple layout calculated', {
            nodeCount: nodes.length,
            levelCount: levelGroups.size
        });

        return positionedNodes;
    }
}

// For backward compatibility
export const ReactFlowLayoutEngine = SimpleReactFlowLayoutHelper;