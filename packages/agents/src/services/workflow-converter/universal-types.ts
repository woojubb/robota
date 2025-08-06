/**
 * Universal Workflow Types
 * 
 * Purpose: Platform-agnostic workflow representation that can be converted to
 * various visualization formats through pluggable converters
 * 
 * Design Principles:
 * - Complete compatibility with existing WorkflowNode structure
 * - Enhanced with position and layout information for visual rendering
 * - Extensible metadata for different visualization needs
 * - Type-safe with comprehensive validation support
 * - Domain-neutral: No specific platform dependencies
 */

import { SimpleLogger } from '../../utils/simple-logger';
import type { WorkflowData } from '../../interfaces/workflow-converter';

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
 * Universal Workflow Node
 * Extended version of WorkflowNode with universal visualization capabilities
 */
export interface UniversalWorkflowNode {
    // Core properties (compatible with existing WorkflowNode)
    id: string;
    type: string; // More flexible than enum for extensibility
    parentId?: string;
    level: number;

    // Enhanced positioning and layout
    position: UniversalPosition;
    dimensions?: UniversalDimensions;

    // Visual state management
    visualState: UniversalVisualState;

    // Content and metadata
    data: {
        // Core data fields
        label: string;
        description?: string;

        // Execution context
        eventType?: string;
        sourceId?: string;
        sourceType?: string;
        toolName?: string;
        agentTemplate?: string;
        executionId?: string;
        parentExecutionId?: string;

        // Tool-specific data
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
        parameters?: unknown;
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
        result?: unknown;
        error?: Error;

        // Visual customization
        icon?: string;
        color?: string;
        className?: string;
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
        style?: Record<string, unknown>;

        // Platform-agnostic extensions
        extensions?: {
            // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
            [platformName: string]: Record<string, unknown>;
        };

        // Additional metadata
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
        metadata?: Record<string, unknown>;
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
    createdAt: Date;
    updatedAt: Date;
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
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
    labelStyle?: Record<string, unknown>;
    labelPosition?: number; // 0-1 along the edge
}

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
            // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
            [platformName: string]: Record<string, unknown>;
        };

        // Additional metadata
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
        metadata?: Record<string, unknown>;
    };

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    timestamp?: number; // Creation timestamp for sequential order validation
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
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
    options?: Record<string, unknown>;
}

/**
 * Universal Workflow Structure
 * Complete workflow representation with metadata and configuration
 */
export interface UniversalWorkflowStructure extends WorkflowData {
    readonly __workflowType: 'UniversalWorkflowStructure';
    // Index signature to satisfy WorkflowData constraint
    [key: string]: unknown;
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
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
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
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
    config?: Record<string, unknown>;

    /** Platform-specific type mappings */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
    typeMapping?: Record<string, unknown>;

    /** Platform-specific viewport or canvas settings */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
    viewport?: Record<string, unknown>;

    /** Platform-specific metadata */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
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
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, third-party
    platformOptions?: Record<string, unknown>;

    /** Logging */
    logger?: SimpleLogger;
}

/**
 * Node type definitions for common workflow patterns
 */
export const UNIVERSAL_NODE_TYPES = {
    // Entry/Exit Points
    USER_INPUT: 'user_input',
    OUTPUT: 'output',

    // Agent Core (Sub types removed for domain neutrality)
    AGENT: 'agent',
    TOOLS_CONTAINER: 'tools_container',
    TOOL_DEFINITION: 'tool_definition',

    // Execution Flow (Sub types removed, Final Response unified to Response)
    AGENT_THINKING: 'agent_thinking',
    TOOL_CALL: 'tool_call',
    MERGE_RESULTS: 'merge_results',
    RESPONSE: 'response', // 🗑️ FINAL_RESPONSE unified to RESPONSE for domain neutrality

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
    // 🗑️ Sub-related edge types removed for domain neutrality: SPAWN, DELEGATE, CONSOLIDATE
    RETURN: 'return',
    FINAL: 'final',
    DELIVER: 'deliver',

    // Conditional
    SUCCESS: 'success',
    ERROR: 'error',
    FALLBACK: 'fallback',
    RETRY: 'retry'
} as const;

// Type exports for convenience
export type UniversalNodeType = typeof UNIVERSAL_NODE_TYPES[keyof typeof UNIVERSAL_NODE_TYPES];
export type UniversalEdgeType = typeof UNIVERSAL_EDGE_TYPES[keyof typeof UNIVERSAL_EDGE_TYPES];