// Universal Workflow Types
// Migrated from agents package to workflow package

import type { WorkflowNode } from '../interfaces/workflow-node.js';
import type { WorkflowSnapshot } from '../interfaces/workflow-builder.js';
import type { WorkflowNodeType } from '../constants/workflow-types.js';
import type { LoggerData, UniversalValue } from '@robota-sdk/agents';

/**
 * Universal position information for nodes
 * Supports both explicit positioning and automatic layout hints
 */
export interface UniversalPosition {
    /** Explicit X coordinate (pixels) */
    x?: number;

    /** Explicit Y coordinate (pixels) */
    y?: number;

    /** Hierarchical level for automatic layout */
    level: number;

    /** Order within the same level */
    order: number;

    /** Layout group identifier for related nodes */
    groupId?: string;

    /** Layout hints for automatic positioning */
    layoutHints?: {
        /** Preferred horizontal alignment */
        align?: 'left' | 'center' | 'right';

        /** Spacing preferences */
        spacing?: 'compact' | 'normal' | 'loose';

        /** Force position constraints */
        constraints?: {
            minX?: number;
            maxX?: number;
            minY?: number;
            maxY?: number;
        };
    };
}

/**
 * Universal visual state for real-time updates
 */
export interface UniversalVisualState {
    /** Current execution status */
    status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';

    /** Visual emphasis level */
    emphasis?: 'normal' | 'highlight' | 'dimmed';

    /** Animation state */
    animation?: {
        type: 'pulse' | 'glow' | 'shake' | 'none';
        duration?: number;
        intensity?: 'low' | 'medium' | 'high';
    };

    /** Progress information for long-running operations */
    progress?: {
        current: number;
        total: number;
        message?: string;
    };

    /** Timestamp of last status change */
    lastUpdated: Date;
}

/**
 * Universal node size information
 * Supports both measured and predefined dimensions
 */
export interface UniversalDimensions {
    /** Predefined width (for SSR/SSG support) */
    width?: number;

    /** Predefined height (for SSR/SSG support) */
    height?: number;

    /** Measured dimensions after rendering */
    measured?: {
        width: number;
        height: number;
    };

    /** Minimum required dimensions */
    minSize?: {
        width: number;
        height: number;
    };

    /** Auto-sizing behavior */
    autoSize?: {
        width: boolean;
        height: boolean;
    };
}

/**
 * Universal edge/connection styling
 */
export interface UniversalEdgeStyle {
    /** Edge type for rendering */
    type?: 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier';

    /** Visual style properties */
    strokeWidth?: number;
    strokeColor?: string;
    strokeDasharray?: string;

    /** Animation properties */
    animated?: boolean;
    animationDuration?: number;

    /** Markers and decorations */
    markerEnd?: string;
    markerStart?: string;

    /** Label styling */
    labelStyle?: Record<string, unknown>;
    labelPosition?: number; // 0-1 along the edge
}

type UniversalWorkflowExtensionValue = UniversalValue | Date | Error | LoggerData;

/**
 * Universal Workflow Edge
 * Represents connections between nodes with rich styling and metadata
 */
export interface UniversalWorkflowEdge {
    id: string;
    source: string; // Source node ID
    target: string; // Target node ID

    // Connection metadata
    type: string; // Connection type (more flexible than enum)
    label?: string;
    description?: string;

    // Handle information for complex nodes
    sourceHandle?: string;
    targetHandle?: string;

    // Visual styling
    style?: UniversalEdgeStyle;

    // Conditional display
    hidden?: boolean;
    conditional?: {
        condition: string;
        fallbackEdge?: string;
    };

    // Platform-specific data
    data?: {
        // Execution flow information
        executionOrder?: number;
        dependsOn?: string[];

        // Visual customization
        className?: string;

        // Platform-agnostic extensions
        extensions?: {
            [platformName: string]: Record<string, UniversalWorkflowExtensionValue | undefined>;
        };

        // Additional metadata
        metadata?: LoggerData;
        extra?: Record<string, UniversalWorkflowExtensionValue>;
    };

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    timestamp?: number; // Creation timestamp for sequential order validation
}

/**
 * Universal Workflow Node
 * Extended version of WorkflowNode with universal visualization capabilities
 */
export interface UniversalWorkflowNode extends WorkflowNode {
    // Enhanced positioning and layout
    position?: UniversalPosition;
    dimensions?: UniversalDimensions;

    // Visual state management
    visualState?: UniversalVisualState;

    // Enhanced data with visual properties
    data: WorkflowNode['data'] & {
        // Visual customization
        icon?: string;
        color?: string;
        className?: string;
        style?: Record<string, unknown>;

        // Platform-agnostic extensions
        extensions?: {
            [platformName: string]: Record<string, unknown>;
        };
    };

    // Interaction and behavior
    interaction?: {
        selectable?: boolean;
        draggable?: boolean;
        deletable?: boolean;
        clickable?: boolean;
        expandable?: boolean;
        collapsible?: boolean;
    };

    // Timestamps
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Layout configuration for automatic positioning
 */
export interface UniversalLayoutConfig {
    /** Layout algorithm to use */
    algorithm: string;

    /** Layout direction */
    direction: 'TB' | 'BT' | 'LR' | 'RL';

    /** Spacing configuration */
    spacing: {
        nodeSpacing: number;
        levelSpacing: number;
        groupSpacing?: number;
    };

    /** Alignment preferences */
    alignment: {
        horizontal: 'left' | 'center' | 'right';
        vertical: 'top' | 'center' | 'bottom';
    };

    /** Canvas bounds */
    bounds?: {
        width: number;
        height: number;
        padding: number;
    };

    /** Algorithm-specific options */
    options?: Record<string, unknown>;
}

/**
 * Universal Workflow Structure
 * Complete workflow representation with metadata and configuration
 */
export interface UniversalWorkflowStructure {
    /** Workflow identification */
    id: string;
    name?: string;
    description?: string;
    version?: string;

    /** Core workflow data */
    nodes: UniversalWorkflowNode[];
    edges: UniversalWorkflowEdge[];

    /** Layout and presentation */
    layout: UniversalLayoutConfig;
    viewport?: {
        x: number;
        y: number;
        zoom: number;
    };

    /** Workflow metadata */
    metadata: {
        /** Creation and modification timestamps */
        createdAt: Date;
        updatedAt: Date;

        /** Execution context */
        executionId?: string;
        sessionId?: string;
        userId?: string;

        /** Performance metrics */
        metrics?: {
            totalNodes: number;
            totalEdges: number;
            executionTime?: number;
            renderTime?: number;
        };

        /** Workflow classification */
        tags?: string[];
        category?: string;

        /** Additional metadata */
        [key: string]: unknown;
    };

    /** Validation state */
    validation?: {
        isValid: boolean;
        errors: string[];
        warnings: string[];
        lastValidated: Date;
    };

    /** Platform-agnostic configurations */
    platforms?: {
        [platformName: string]: UniversalPlatformConfig;
    };
}

/**
 * Platform configuration interface for extensible platform support
 */
export interface UniversalPlatformConfig {
    /** Platform-specific theme or style configuration */
    theme?: string;

    /** Platform-specific rendering configuration */
    config?: Record<string, unknown>;

    /** Platform-specific type mappings */
    typeMapping?: Record<string, unknown>;

    /** Platform-specific viewport or canvas settings */
    viewport?: Record<string, unknown>;

    /** Platform-specific metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Conversion options for platform-agnostic exports
 */
export interface UniversalConversionOptions {
    /** Target platform identifier */
    platform: string;

    /** Include debug information */
    includeDebug?: boolean;

    /** Validation options */
    validate?: boolean;
    strict?: boolean;

    /** Layout options */
    autoLayout?: boolean;
    layoutConfig?: Partial<UniversalLayoutConfig>;

    /** Filtering options */
    nodeFilter?: (node: UniversalWorkflowNode) => boolean;
    edgeFilter?: (edge: UniversalWorkflowEdge) => boolean;

    /** Transformation options */
    nodeTransform?: (node: UniversalWorkflowNode) => UniversalWorkflowNode;
    edgeTransform?: (edge: UniversalWorkflowEdge) => UniversalWorkflowEdge;

    /** Platform-specific options */
    platformOptions?: Record<string, unknown>;
}

/**
 * Node type definitions for common workflow patterns
 */
export const UNIVERSAL_NODE_TYPES = {
    // Entry/Exit Points
    USER_INPUT: 'user_input',
    USER_MESSAGE: 'user_message',
    OUTPUT: 'output',

    // Agent Core
    AGENT: 'agent',
    TOOLS_CONTAINER: 'tools_container',
    TOOL_DEFINITION: 'tool_definition',

    // Execution Flow
    AGENT_THINKING: 'agent_thinking',
    TOOL_CALL: 'tool_call',
    TOOL_CALL_RESPONSE: 'tool_call_response',
    RESPONSE: 'response',
    TOOL_RESULT: 'tool_result',

    // Special Nodes
    GROUP: 'group',
    BRANCH: 'branch',
    CONDITION: 'condition',
    LOOP: 'loop',
    ERROR: 'error'
} as const;

/**
 * Edge type definitions for common connection patterns
 */
export const UNIVERSAL_EDGE_TYPES = {
    // Structural
    HAS_TOOLS: 'has_tools',
    CONTAINS: 'contains',

    // Data Flow
    RECEIVES: 'receives',
    PROCESSES: 'processes',
    EXECUTES: 'executes',
    RESULT: 'result',

    // Control Flow
    BRANCH: 'branch',
    ANALYZE: 'analyze',
    RETURN: 'return',
    FINAL: 'final',
    DELIVER: 'deliver',
    CREATES: 'creates',
    TRIGGERS: 'triggers',
    CONTINUES: 'continues',
    INTEGRATES: 'integrates',
    FINALIZES: 'finalizes',

    // Conditional
    SUCCESS: 'success',
    ERROR: 'error',
    FALLBACK: 'fallback',
    RETRY: 'retry'
} as const;

// Type exports for convenience
export type UniversalNodeType = typeof UNIVERSAL_NODE_TYPES[keyof typeof UNIVERSAL_NODE_TYPES];
export type UniversalEdgeType = typeof UNIVERSAL_EDGE_TYPES[keyof typeof UNIVERSAL_EDGE_TYPES];
