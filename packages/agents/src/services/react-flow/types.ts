/**
 * React-Flow v12 Type Definitions
 * 
 * Purpose: Define TypeScript interfaces for React-Flow v12 integration
 * Architecture: Domain-specific types for React-Flow platform
 * Patterns: Interface Segregation, Single Responsibility
 */

import type { GenericConfig, GenericMetadata, primitive, ConfigValue, MetadataValue } from '../../interfaces/base-types';

// ================================
// React-Flow v12 Core Types
// ================================

/**
 * React-Flow Node Position (v12 compatible)
 */
export interface ReactFlowPosition {
    x: number;
    y: number;
}

/**
 * React-Flow Node Dimensions (v12 compatible)
 */
export interface ReactFlowDimensions {
    width?: number;
    height?: number;
}

/**
 * React-Flow Node Data (extensible)
 */
export interface ReactFlowNodeData {
    label: string;
    description?: string;
    icon?: string;
    toolName?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed';
    executionId?: string;
    metadata?: GenericMetadata;
    // Additional config properties can be added explicitly as needed
    [key: string]: ConfigValue | GenericMetadata | undefined;
}

/**
 * React-Flow Node (v12 structure)
 */
export interface ReactFlowNode {
    id: string;
    type?: string;
    position: ReactFlowPosition;
    data: ReactFlowNodeData;
    
    // v12 features
    width?: number;
    height?: number;
    style?: Record<string, primitive>;
    className?: string;
    draggable?: boolean;
    selectable?: boolean;
    deletable?: boolean;
    hidden?: boolean;
    selected?: boolean;
    
    // Extensibility
    [key: string]: unknown;
}

/**
 * React-Flow Edge Data (extensible)
 */
export interface ReactFlowEdgeData {
    label?: string;
    description?: string;
    connectionType?: 'execution' | 'creation' | 'return' | 'data';
    animated?: boolean;
    metadata?: GenericMetadata;
    // Additional config properties can be added explicitly as needed
    [key: string]: ConfigValue | GenericMetadata | undefined;
}

/**
 * React-Flow Edge (v12 structure)
 */
export interface ReactFlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    type?: string;
    
    // Edge styling
    style?: Record<string, primitive>;
    className?: string;
    animated?: boolean;
    hidden?: boolean;
    selected?: boolean;
    selectable?: boolean;
    deletable?: boolean;
    
    // Data
    data?: ReactFlowEdgeData;
    
    // Extensibility
    [key: string]: unknown;
}

/**
 * React-Flow Viewport Configuration (v12)
 */
export interface ReactFlowViewport {
    x: number;
    y: number;
    zoom: number;
}

/**
 * React-Flow Theme Configuration
 */
export interface ReactFlowThemeConfig {
    colorMode?: 'light' | 'dark' | 'system';
    nodeStyles?: Record<string, Record<string, primitive>>;
    edgeStyles?: Record<string, Record<string, primitive>>;
    backgroundStyle?: Record<string, primitive>;
    // Additional theme config properties
    [key: string]: ConfigValue | undefined;
}

/**
 * React-Flow Data Structure (complete)
 */
export interface ReactFlowData {
    nodes: ReactFlowNode[];
    edges: ReactFlowEdge[];
    viewport?: ReactFlowViewport;
    theme?: ReactFlowThemeConfig;
    metadata?: GenericMetadata;
    
    // v12 features
    fitView?: boolean;
    fitViewOptions?: {
        padding?: number;
        includeHiddenNodes?: boolean;
        minZoom?: number;
        maxZoom?: number;
        duration?: number;
    };
    
    // Extensibility
    [key: string]: unknown;
}

// ================================
// Node Type Mappings
// ================================

/**
 * Universal to React-Flow Node Type Mapping
 */
export interface NodeTypeMapping {
    [universalType: string]: string; // Universal type -> React-Flow type
}

/**
 * Default Node Type Mappings
 */
export const DEFAULT_NODE_TYPE_MAPPING: NodeTypeMapping = {
    'agent': 'robotaAgent',
    'tool_call': 'robotaTool', 
    'user_input': 'robotaUser',
    'response': 'robotaResponse',
    'team': 'robotaTeam',
    'group': 'robotaGroup',
    'default': 'robotaDefault'
};

// ================================
// Edge Type Mappings  
// ================================

/**
 * Universal to React-Flow Edge Type Mapping
 */
export interface EdgeTypeMapping {
    [universalType: string]: string; // Universal type -> React-Flow type
}

/**
 * Default Edge Type Mappings
 */
export const DEFAULT_EDGE_TYPE_MAPPING: EdgeTypeMapping = {
    'execution': 'robotaExecution',
    'creation': 'robotaCreation', 
    'return': 'robotaReturn',
    'data': 'robotaData',
    'default': 'robotaDefault'
};

// ================================
// Style and Theme Types
// ================================

/**
 * React-Flow Node Style Configuration
 */
export interface ReactFlowNodeStyle {
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    color?: string;
    fontSize?: number;
    fontWeight?: string | number;
    padding?: number;
    minWidth?: number;
    minHeight?: number;
    // Additional style properties
    [key: string]: primitive;
}

/**
 * React-Flow Edge Style Configuration  
 */
export interface ReactFlowEdgeStyle {
    stroke?: string;
    strokeWidth?: number;
    strokeDasharray?: string;
    markerEnd?: string;
    opacity?: number;
    // Additional style properties
    [key: string]: primitive;
}

// ================================
// Configuration Types
// ================================

/**
 * React-Flow Converter Configuration
 */
export interface ReactFlowConverterConfig {
    // Layout settings
    nodeSpacing?: {
        horizontal: number;
        vertical: number;
    };
    
    // Type mappings
    nodeTypeMapping?: NodeTypeMapping;
    edgeTypeMapping?: EdgeTypeMapping;
    
    // Styling
    theme?: ReactFlowThemeConfig;
    
    // Features
    enableAnimation?: boolean;
    enableSelection?: boolean;
    enableDeletion?: boolean;
    fitViewOnLoad?: boolean;
    
    // Performance
    maxNodes?: number;
    maxEdges?: number;
    
    // Additional config properties
    [key: string]: ConfigValue | undefined;
}

/**
 * React-Flow Layout Configuration
 */
export interface ReactFlowLayoutConfig {
    algorithm?: 'hierarchical' | 'dagre' | 'force' | 'grid';
    direction?: 'TB' | 'BT' | 'LR' | 'RL'; // Top-Bottom, Bottom-Top, Left-Right, Right-Left
    nodeSpacing?: {
        horizontal: number;
        vertical: number;
    };
    rankSpacing?: number;
    edgeSpacing?: number;
    
    // Hierarchical specific
    levelSeparation?: number;
    nodeSeparation?: number;
    
    // Force specific  
    iterations?: number;
    strength?: number;
    
    // Grid specific
    columns?: number;
    
    // Additional layout config properties
    [key: string]: ConfigValue | undefined;
}

// ================================
// Metadata and Result Types
// ================================

/**
 * React-Flow Conversion Metadata
 */
export interface ReactFlowConversionMetadata {
    sourceFormat: 'UniversalWorkflow';
    targetFormat: 'ReactFlow';
    conversionTimestamp: Date;
    nodeCount: number;
    edgeCount: number;
    layoutAlgorithm?: string;
    theme?: string;
    converterVersion: string;
    // Additional metadata properties
    [key: string]: MetadataValue;
}

/**
 * React-Flow Conversion Result
 */
export interface ReactFlowConversionResult {
    success: boolean;
    data?: ReactFlowData;
    error?: string;
    metadata: ReactFlowConversionMetadata;
    warnings?: string[];
}