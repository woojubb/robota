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
import type { IToolResult, TContextData, TLoggerData, TUniversalValue } from '@robota-sdk/agents';
import type { IWorkflowNodeExtensions } from '@robota-sdk/workflow';

/**
 * React-Flow data value axis.
 *
 * IMPORTANT:
 * - React-Flow `data` is a pass-through container used by UI renderers.
 * - It must support the workflow payload axis without using `any`/`unknown`.
 */
export type TReactFlowDataValue =
    | TUniversalValue
    | Date
    | Error
    | TLoggerData
    | IToolResult
    | TContextData
    | IWorkflowNodeExtensions
    | IReactFlowPlatformExtensions;

/**
 * Platform extension dictionary for pass-through UI data.
 *
 * NOTE:
 * - This is intentionally recursive to support nested extension objects.
 * - Avoid `any`/`unknown` by using the shared value axis.
 */
export interface IReactFlowPlatformExtensions {
    [platformName: string]: Record<string, TReactFlowDataValue | undefined>;
}

export interface IReactFlowNodeData {
    label: string;
    [key: string]: TReactFlowDataValue;
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
    [key: string]: TReactFlowDataValue;
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