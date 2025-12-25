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
export interface IReactFlowPosition {
    x: number;
    y: number;
}

/**
 * React-Flow Node Data (Pass-through container)
 */
import type { TUniversalValue } from '@robota-sdk/agents';

export interface IReactFlowNodeData {
    label: string;
    [key: string]: TUniversalValue;
}

/**
 * React-Flow Node (Minimal v12 structure)
 */
export interface IReactFlowNode {
    id: string;
    type?: string;
    position: IReactFlowPosition;
    data: IReactFlowNodeData;
}

/**
 * React-Flow Edge Data (Pass-through container)
 */
export interface IReactFlowEdgeData {
    [key: string]: TUniversalValue;
}

/**
 * React-Flow Edge (Minimal v12 structure)
 */
export interface IReactFlowEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    data?: IReactFlowEdgeData;
}

/**
 * React-Flow Data Structure
 */
export interface IReactFlowData {
    nodes: IReactFlowNode[];
    edges: IReactFlowEdge[];
}