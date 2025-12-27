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
    UniversalToReactFlowConverter,
} from './react-flow';

export type {
    IReactFlowData,
    IReactFlowNode,
    IReactFlowEdge,
    IReactFlowPosition,
    IReactFlowNodeData,
    IReactFlowEdgeData
} from './react-flow/types';

export {
    SimpleReactFlowLayoutHelper
} from './react-flow/layout-engine';

// Auto Layout Integration
export {
    applyDagreLayout,
    convertUniversalToReactFlowWithLayout,
    layoutExistingFlow,
    suggestOptimalLayout,
    LAYOUT_PRESETS
} from './auto-layout';

export type {
    ILayoutConfig
} from './auto-layout';

export type {
    ISimpleLayoutOptions
} from './react-flow/layout-engine';

// Mermaid Integration
// Mermaid integration intentionally omitted from @robota-sdk/playground.
// The playground package focuses on React-based visualization surfaces only.