// Workflow Edge Interfaces
// Based on existing UniversalWorkflowEdge implementation

import type { TWorkflowConnectionType } from './workflow-node.js';
import type { TLoggerData, TUniversalValue } from '@robota-sdk/agents';

export type TWorkflowEdgeDataExtensionValue = TUniversalValue | Date | Error | TLoggerData;

/**
 * Edge validation rule interface
 */
export interface IEdgeValidationRule {
    sourceNodeType?: string | string[];
    targetNodeType?: string | string[];
    allowedConnectionTypes?: TWorkflowConnectionType[];
    required?: boolean;
    description?: string;
}

/**
 * Core workflow edge interface
 * Based on existing UniversalWorkflowEdge from universal-types
 */
export interface IWorkflowEdge {
    id: string;
    source: string; // Source node ID
    target: string; // Target node ID
    
    // Connection metadata
    type: TWorkflowConnectionType; // Connection type
    label?: string;
    description?: string;
    
    // Handle information for complex nodes
    sourceHandle?: string;
    targetHandle?: string;
    
    // Execution flow information
    executionOrder?: number;
    dependsOn?: string[];
    
    // Conditional display
    hidden?: boolean;
    conditional?: {
        condition: string;
        fallbackEdge?: string;
    };
    
    // Additional metadata
    data?: {
        className?: string;
        metadata?: TLoggerData;
        extensions?: { [platformName: string]: Record<string, TWorkflowEdgeDataExtensionValue | undefined> };
        extra?: Record<string, TWorkflowEdgeDataExtensionValue>;
    };
    
    // Timestamps for ordering
    timestamp: number; // Creation timestamp for sequential order validation
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Edge creation options
 */
export interface IEdgeCreationOptions {
    label?: string;
    description?: string;
    sourceHandle?: string;
    targetHandle?: string;
    executionOrder?: number;
    dependsOn?: string[];
    hidden?: boolean;
    autoTimestamp?: boolean;
    metadata?: TLoggerData;
}

/**
 * Edge update event
 */
export interface IWorkflowEdgeUpdate {
    action: 'create' | 'update' | 'delete';
    edge: IWorkflowEdge;
}

/**
 * Edge query filters
 */
export interface IEdgeQueryFilter {
    sourceId?: string;
    targetId?: string;
    type?: TWorkflowConnectionType | TWorkflowConnectionType[];
    hidden?: boolean;
    fromTimestamp?: number;
    toTimestamp?: number;
}

/**
 * Type guard for WorkflowEdge
 */
export function isWorkflowEdge(obj: object): obj is IWorkflowEdge {
    return (
        typeof (obj as IWorkflowEdge).id === 'string' &&
        typeof (obj as IWorkflowEdge).source === 'string' &&
        typeof (obj as IWorkflowEdge).target === 'string' &&
        typeof (obj as IWorkflowEdge).type === 'string' &&
        typeof (obj as IWorkflowEdge).timestamp === 'number'
    );
}

/**
 * Edge utility functions
 */
export class EdgeUtils {
    /**
     * Generate edge ID from source and target
     */
    static generateId(sourceId: string, targetId: string, type: TWorkflowConnectionType): string {
        return `edge_${sourceId}_${targetId}_${type}`;
    }
    
    /**
     * Check if edge creates a cycle
     */
    static wouldCreateCycle(edges: IWorkflowEdge[], sourceId: string, targetId: string): boolean {
        // Simple cycle detection - can be enhanced later
        if (sourceId === targetId) return true;
        
        const adjacencyMap = new Map<string, Set<string>>();
        
        // Build adjacency map
        edges.forEach(edge => {
            if (!adjacencyMap.has(edge.source)) {
                adjacencyMap.set(edge.source, new Set());
            }
            adjacencyMap.get(edge.source)!.add(edge.target);
        });
        
        // Add proposed edge temporarily
        if (!adjacencyMap.has(sourceId)) {
            adjacencyMap.set(sourceId, new Set());
        }
        adjacencyMap.get(sourceId)!.add(targetId);
        
        // DFS to detect cycle
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        
        const hasCycle = (nodeId: string): boolean => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;
            
            visited.add(nodeId);
            recursionStack.add(nodeId);
            
            const neighbors = adjacencyMap.get(nodeId) || new Set();
            for (const neighbor of neighbors) {
                if (hasCycle(neighbor)) return true;
            }
            
            recursionStack.delete(nodeId);
            return false;
        };
        
        return hasCycle(sourceId);
    }
}
