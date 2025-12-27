// Universal Workflow Types
// Migrated from agents package to workflow package

import type { IWorkflowNode } from '../interfaces/workflow-node.js';
import type { TLoggerData, TUniversalValue } from '@robota-sdk/agents';

/**
 * Universal position information for nodes
 * Supports both explicit positioning and automatic layout hints
 */
export interface IUniversalPosition {
    /** Explicit X coordinate (pixels) */
    x?: number;

    /** Explicit Y coordinate (pixels) */
    y?: number;

    /** Hierarchical level for automatic layout */
    level: number;

    /** Order within the same level */
    order: number;

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
export interface IUniversalVisualState {
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
export interface IUniversalDimensions {
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
export interface IUniversalEdgeStyle {
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
    labelStyle?: Record<string, TUniversalWorkflowExtensionValue | undefined>;
    labelPosition?: number; // 0-1 along the edge
}

type TUniversalWorkflowExtensionValue = TUniversalValue | Date | Error | TLoggerData;

/**
 * Universal Workflow Edge
 * Represents connections between nodes with rich styling and metadata
 */
export interface IUniversalWorkflowEdge {
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
    style?: IUniversalEdgeStyle;

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
            [platformName: string]: Record<string, TUniversalWorkflowExtensionValue | undefined>;
        };

        // Additional metadata
        metadata?: TLoggerData;
        extra?: Record<string, TUniversalWorkflowExtensionValue>;
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
export interface IUniversalWorkflowNode extends IWorkflowNode {
    // Enhanced positioning and layout
    position?: IUniversalPosition;
    dimensions?: IUniversalDimensions;

    // Visual state management
    visualState?: IUniversalVisualState;

    // Enhanced data with visual properties
    data: IWorkflowNode['data'] & {
        // Visual customization
        icon?: string;
        color?: string;
        className?: string;
        style?: Record<string, TUniversalWorkflowExtensionValue | undefined>;

        // Platform-agnostic extensions
        extensions?: {
            [platformName: string]: Record<string, TUniversalWorkflowExtensionValue | undefined>;
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
export interface IUniversalLayoutConfig {
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
    options?: Record<string, TUniversalWorkflowExtensionValue | undefined>;
}

/**
 * Universal Workflow Structure
 * Complete workflow representation with metadata and configuration
 */
export interface IUniversalWorkflowStructure {
    /** Workflow identification */
    id: string;
    name?: string;
    description?: string;
    version?: string;

    /** Core workflow data */
    nodes: IUniversalWorkflowNode[];
    edges: IUniversalWorkflowEdge[];

    /** Layout and presentation */
    layout: IUniversalLayoutConfig;
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
        [key: string]: TUniversalWorkflowExtensionValue | undefined;
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
        [platformName: string]: IUniversalPlatformConfig;
    };
}

/**
 * Platform configuration interface for extensible platform support
 */
export interface IUniversalPlatformConfig {
    /** Platform-specific theme or style configuration */
    theme?: string;

    /** Platform-specific rendering configuration */
    config?: Record<string, TUniversalWorkflowExtensionValue | undefined>;

    /** Platform-specific type mappings */
    typeMapping?: Record<string, TUniversalWorkflowExtensionValue | undefined>;

    /** Platform-specific viewport or canvas settings */
    viewport?: Record<string, TUniversalWorkflowExtensionValue | undefined>;

    /** Platform-specific metadata */
    metadata?: Record<string, TUniversalWorkflowExtensionValue | undefined>;
}

/**
 * Conversion options for platform-agnostic exports
 */
export interface IUniversalConversionOptions {
    /** Target platform identifier */
    platform: string;

    /** Include debug information */
    includeDebug?: boolean;

    /** Validation options */
    validate?: boolean;
    strict?: boolean;

    /** Layout options */
    autoLayout?: boolean;
    layoutConfig?: Partial<IUniversalLayoutConfig>;

    /** Filtering options */
    nodeFilter?: (node: IUniversalWorkflowNode) => boolean;
    edgeFilter?: (edge: IUniversalWorkflowEdge) => boolean;

    /** Transformation options */
    nodeTransform?: (node: IUniversalWorkflowNode) => IUniversalWorkflowNode;
    edgeTransform?: (edge: IUniversalWorkflowEdge) => IUniversalWorkflowEdge;

    /** Platform-specific options */
    platformOptions?: Record<string, TUniversalWorkflowExtensionValue | undefined>;
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
export type TUniversalNodeType = typeof UNIVERSAL_NODE_TYPES[keyof typeof UNIVERSAL_NODE_TYPES];
export type TUniversalEdgeType = typeof UNIVERSAL_EDGE_TYPES[keyof typeof UNIVERSAL_EDGE_TYPES];
