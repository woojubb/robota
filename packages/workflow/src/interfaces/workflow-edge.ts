// Workflow Edge Interfaces
// Based on existing UniversalWorkflowEdge implementation

import type { WorkflowConnectionType } from './workflow-node.js';
import type { LoggerData, UniversalValue } from '@robota-sdk/agents';

type WorkflowEdgeDataExtensionValue = UniversalValue | Date | Error | LoggerData;

/**
 * Edge validation rule interface
 */
export interface EdgeValidationRule {
    sourceNodeType?: string | string[];
    targetNodeType?: string | string[];
    allowedConnectionTypes?: WorkflowConnectionType[];
    required?: boolean;
    description?: string;
}

/**
 * Core workflow edge interface
 * Based on existing UniversalWorkflowEdge from universal-types
 */
export interface WorkflowEdge {
    id: string;
    source: string; // Source node ID
    target: string; // Target node ID
    
    // Connection metadata
    type: WorkflowConnectionType; // Connection type
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
        metadata?: LoggerData;
        extensions?: { [platformName: string]: Record<string, WorkflowEdgeDataExtensionValue | undefined> };
        extra?: Record<string, WorkflowEdgeDataExtensionValue>;
    };
    
    // Timestamps for ordering
    timestamp: number; // Creation timestamp for sequential order validation
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Edge creation options
 */
export interface EdgeCreationOptions {
    label?: string;
    description?: string;
    sourceHandle?: string;
    targetHandle?: string;
    executionOrder?: number;
    dependsOn?: string[];
    hidden?: boolean;
    autoTimestamp?: boolean;
    metadata?: LoggerData;
}

/**
 * Edge update event
 */
export interface WorkflowEdgeUpdate {
    action: 'create' | 'update' | 'delete';
    edge: WorkflowEdge;
}

/**
 * Edge query filters
 */
export interface EdgeQueryFilter {
    sourceId?: string;
    targetId?: string;
    type?: WorkflowConnectionType | WorkflowConnectionType[];
    hidden?: boolean;
    fromTimestamp?: number;
    toTimestamp?: number;
}

/**
 * Type guard for WorkflowEdge
 */
export function isWorkflowEdge(obj: object): obj is WorkflowEdge {
    return (
        typeof (obj as WorkflowEdge).id === 'string' &&
        typeof (obj as WorkflowEdge).source === 'string' &&
        typeof (obj as WorkflowEdge).target === 'string' &&
        typeof (obj as WorkflowEdge).type === 'string' &&
        typeof (obj as WorkflowEdge).timestamp === 'number'
    );
}

/**
 * Edge utility functions
 */
export class EdgeUtils {
    /**
     * Generate edge ID from source and target
     */
    static generateId(sourceId: string, targetId: string, type: WorkflowConnectionType): string {
        return `edge_${sourceId}_${targetId}_${type}`;
    }
    
    /**
     * Check if edge creates a cycle
     */
    static wouldCreateCycle(edges: WorkflowEdge[], sourceId: string, targetId: string): boolean {
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
