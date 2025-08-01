/**
 * Simple React-Flow Types
 * 
 * Purpose: Minimal type definitions for React-Flow v12 integration
 * Principle: Use React-Flow native types, avoid over-engineering
 */

// ================================
// React-Flow v12 Core Types (Simplified)
// ================================

/**
 * React-Flow Node Position
 */
export interface ReactFlowPosition {
    x: number;
    y: number;
}

/**
 * React-Flow Node Data (Pass-through container)
 */
export interface ReactFlowNodeData {
    label: string;
    [key: string]: any; // Let React-Flow handle any data structure
}

/**
 * React-Flow Node (Minimal v12 structure)
 */
export interface ReactFlowNode {
    id: string;
    type?: string;
    position: ReactFlowPosition;
    data: ReactFlowNodeData;
}

/**
 * React-Flow Edge Data (Pass-through container)
 */
export interface ReactFlowEdgeData {
    [key: string]: any; // Let React-Flow handle any data structure
}

/**
 * React-Flow Edge (Minimal v12 structure)
 */
export interface ReactFlowEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    data?: ReactFlowEdgeData;
}

/**
 * React-Flow Data Structure
 */
export interface ReactFlowData {
    nodes: ReactFlowNode[];
    edges: ReactFlowEdge[];
}