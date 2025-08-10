// Default Configuration Values
// Centralized default values for workflow system

/**
 * Default workflow configuration values
 * These constants provide sensible defaults for workflow operations
 */
export const WORKFLOW_DEFAULTS = {
    // Node configuration
    NODE_LEVEL: 1,
    INITIAL_STATUS: 'pending' as const,
    AUTO_TIMESTAMP: true,

    // Connection and validation
    VALIDATE_CONNECTIONS: true,
    MAX_RECURSION_DEPTH: 10,

    // Timing and performance
    DEFAULT_TIMEOUT: 30000, // 30 seconds
    PROCESSING_DELAY: 0, // No delay by default
    BATCH_SIZE: 100,

    // Event handling
    EVENT_QUEUE_SIZE: 1000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // 1 second

    // Plugin system
    PLUGIN_PRIORITY: 50,
    PLUGIN_TIMEOUT: 5000, // 5 seconds
    MAX_PLUGINS: 50,

    // Logging
    LOG_LEVEL: 'info' as const,
    DEBUG_MODE: false,
} as const;

/**
 * Workflow validation constraints
 * These limits help prevent system overload and ensure reasonable performance
 */
export const WORKFLOW_CONSTRAINTS = {
    // Size limits
    MAX_NODES: 10000,
    MAX_EDGES: 50000,
    MAX_PLUGINS: 50,

    // String length limits
    MAX_NODE_LABEL_LENGTH: 500,
    MAX_EDGE_LABEL_LENGTH: 200,
    MAX_DESCRIPTION_LENGTH: 2000,

    // ID constraints
    MIN_NODE_ID_LENGTH: 1,
    MAX_NODE_ID_LENGTH: 255,
    MIN_EDGE_ID_LENGTH: 1,
    MAX_EDGE_ID_LENGTH: 255,

    // Performance limits
    MAX_PROCESSING_TIME: 60000, // 1 minute
    MAX_EVENT_DATA_SIZE: 1048576, // 1MB
    MAX_BATCH_OPERATIONS: 1000,

    // Depth and complexity
    MAX_GRAPH_DEPTH: 100,
    MAX_NODE_CONNECTIONS: 1000,
    MAX_PLUGIN_DEPTH: 10,
} as const;

/**
 * Default event processing configuration
 */
export const EVENT_PROCESSING_DEFAULTS = {
    // Processing behavior
    PROCESS_ASYNC: true,
    PRESERVE_ORDER: true,
    ENABLE_BATCHING: false,

    // Error handling
    STOP_ON_ERROR: false,
    LOG_ERRORS: true,
    RETRY_ON_FAILURE: true,

    // Performance
    CONCURRENT_LIMIT: 10,
    QUEUE_HIGH_WATERMARK: 1000,
    DEBOUNCE_TIME: 100, // milliseconds
} as const;

/**
 * Default logging configuration
 */
export const LOGGING_DEFAULTS = {
    // Log levels
    LEVELS: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3,
    } as const,

    // Default settings
    DEFAULT_LEVEL: 2, // INFO
    INCLUDE_TIMESTAMP: true,
    INCLUDE_LEVEL: true,
    INCLUDE_SOURCE: false,

    // Format settings
    MAX_MESSAGE_LENGTH: 1000,
    TRUNCATE_LONG_MESSAGES: true,
} as const;

/**
 * Connection type priorities for automatic layout
 * Higher numbers indicate higher layout priority
 */
export const CONNECTION_PRIORITIES = {
    'receives': 100,      // User input connections
    'processes': 90,      // Main processing flow
    'executes': 80,       // Tool execution
    'creates': 70,        // Agent creation
    'return': 60,         // Response flow
    'result': 50,         // Tool results
    'analyze': 40,        // Analysis connections
    'integrates': 30,     // Integration connections
    'branch': 20,         // Branching logic
    'final': 10,          // Final outputs
    'deliver': 5,         // Delivery connections
} as const;

/**
 * Node type display priorities for UI rendering
 * Higher numbers render on top
 */
export const NODE_DISPLAY_PRIORITIES = {
    'user_input': 100,        // Always visible
    'user_message': 95,       // User messages prominent
    'agent': 90,              // Agents high priority
    'agent_thinking': 80,     // Thinking processes
    'tool_call': 70,          // Tool executions
    'tool_call_response': 65, // Tool responses
    'response': 60,           // Agent responses
    'tool_result': 50,        // Aggregated results
    'tools_container': 40,    // Tool containers
    'tool_definition': 35,    // Tool definitions
    'output': 30,             // Final outputs
} as const;

/**
 * Default node styling configuration
 */
export const NODE_STYLE_DEFAULTS = {
    // Size defaults
    DEFAULT_WIDTH: 200,
    DEFAULT_HEIGHT: 100,
    MIN_WIDTH: 100,
    MIN_HEIGHT: 50,

    // Spacing
    HORIZONTAL_SPACING: 250,
    VERTICAL_SPACING: 150,
    LEVEL_SPACING: 200,

    // Visual properties
    BORDER_RADIUS: 8,
    BORDER_WIDTH: 2,
    FONT_SIZE: 14,
    PADDING: 16,
} as const;

/**
 * Performance monitoring thresholds
 */
export const PERFORMANCE_THRESHOLDS = {
    // Processing time warnings (milliseconds)
    SLOW_OPERATION: 1000,
    VERY_SLOW_OPERATION: 5000,

    // Memory usage warnings (bytes)
    HIGH_MEMORY: 50 * 1024 * 1024, // 50MB
    VERY_HIGH_MEMORY: 100 * 1024 * 1024, // 100MB

    // Event queue warnings
    QUEUE_WARNING_SIZE: 500,
    QUEUE_CRITICAL_SIZE: 800,

    // Node/edge count warnings
    LARGE_WORKFLOW: 1000,
    HUGE_WORKFLOW: 5000,
} as const;
