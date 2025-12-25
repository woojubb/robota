/**
 * Simple React-Flow Layout Helper
 * 
 * Purpose: Minimal layout assistance for React-Flow positioning
 * Principle: Basic positioning only - let React-Flow handle complex layouts
 */

import type { IUniversalWorkflowNode } from '@robota-sdk/workflow';
import { SilentLogger, type SimpleLogger } from '@robota-sdk/agents';

/**
 * Simple layout options
 */
export interface ISimpleLayoutOptions {
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
        nodes: IUniversalWorkflowNode[],
        options: ISimpleLayoutOptions = {}
    ): IUniversalWorkflowNode[] {
        const nodeSpacing = options.nodeSpacing ?? 150;
        const levelSpacing = options.levelSpacing ?? 100;

        // Group nodes by level
        const levelGroups = new Map<number, IUniversalWorkflowNode[]>();
        nodes.forEach(node => {
            const level = node.level;
            if (!levelGroups.has(level)) {
                levelGroups.set(level, []);
            }
            levelGroups.get(level)!.push(node);
        });

        // Simple positioning: spread nodes horizontally by level
        const positionedNodes: IUniversalWorkflowNode[] = [];
        
        for (const [level, levelNodes] of levelGroups.entries()) {
            const startX = -(levelNodes.length - 1) * nodeSpacing / 2;
            
            levelNodes.forEach((node, index) => {
                positionedNodes.push({
                    ...node,
                    position: {
                        x: startX + (index * nodeSpacing),
                        y: level * levelSpacing,
                        level,
                        order: index,
                        layoutHints: node.position?.layoutHints
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