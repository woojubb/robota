/**
 * Workflow Visualization Library for apps/web
 * 
 * This module contains UI-specific workflow visualization features
 * that depend on external UI libraries (React-Flow, Mermaid, etc.)
 * 
 * These were moved from @robota-sdk/agents to maintain clean separation
 * between pure business logic and UI dependencies.
 */

// React-Flow Integration
export {
    SimpleReactFlowConverter,
    UniversalToReactFlowConverter
} from './react-flow';

export type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge,
    ReactFlowPosition,
    ReactFlowNodeData,
    ReactFlowEdgeData
} from './react-flow/types';

export {
    SimpleReactFlowLayoutHelper
} from './react-flow/layout-engine';

export type {
    SimpleLayoutOptions
} from './react-flow/layout-engine';

// Mermaid Integration
export {
    RealTimeMermaidGenerator
} from './mermaid';

export type {
    MermaidNodeClassMapping,
    MermaidNodeEmojiMapping,
    MermaidStatusMapping,
    MermaidShapeMapping,
    MermaidArrowMapping,
    MermaidLabelMapping,
    MermaidDiagramConfig,
    MermaidNodeDefinition,
    MermaidEdgeDefinition
} from './mermaid/types';