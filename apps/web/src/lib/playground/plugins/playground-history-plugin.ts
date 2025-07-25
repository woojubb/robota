/**
 * PlaygroundHistoryPlugin - Robota SDK Compliant Plugin for Browser
 * 
 * Follows Robota SDK Architecture Principles:
 * - Extends BasePlugin<TOptions, TStats> with proper types
 * - Implements enable/disable options (enabled: false, strategy: 'silent')
 * - Provides comprehensive validation with actionable errors
 * - Uses category and priority system
 * - Dependency injection pattern for logging
 * - Single responsibility: History capture and visualization only
 */

// Robota SDK-compatible types for browser environment
export enum PluginCategory {
    MONITORING = 'monitoring',
    LOGGING = 'logging',
    STORAGE = 'storage',
    NOTIFICATION = 'notification',
    SECURITY = 'security',
    PERFORMANCE = 'performance',
    ERROR_HANDLING = 'error_handling',
    LIMITS = 'limits',
    EVENT_PROCESSING = 'event_processing',
    CUSTOM = 'custom'
}

export enum PluginPriority {
    CRITICAL = 1000,
    HIGH = 800,
    NORMAL = 500,
    LOW = 200,
    MINIMAL = 100
}

export interface BasePluginOptions {
    enabled?: boolean;
    strategy?: 'silent' | 'none' | string;
    category?: PluginCategory;
    priority?: PluginPriority | number;
}

export interface PluginStats {
    calls: number;
    errors: number;
    lastActivity?: Date;
    [key: string]: unknown;
}

// Logger interface for dependency injection
export interface SimpleLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    log(...args: unknown[]): void;
}

// Silent logger implementation (default for production safety)
export const SilentLogger: SimpleLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    log: () => { }
};

// Browser console logger (explicit opt-in for development)
export const BrowserConsoleLogger: SimpleLogger = {
    debug: (...args) => console.debug('[Playground]', ...args),
    info: (...args) => console.info('[Playground]', ...args),
    warn: (...args) => console.warn('[Playground]', ...args),
    error: (...args) => console.error('[Playground]', ...args),
    log: (...args) => console.log('[Playground]', ...args)
};

// PlaygroundHistoryPlugin specific options
export interface PlaygroundHistoryPluginOptions extends BasePluginOptions {
    websocketUrl?: string;
    enableRealTimeSync?: boolean;
    maxEvents?: number;
    visualizationMode?: 'blocks' | 'timeline' | 'tree';
    logger?: SimpleLogger;
    subscribeToAllModuleEvents?: boolean;  // Added for auto event subscription
    moduleEvents?: string[];  // Added for specific event subscription
}

export interface PlaygroundHistoryPluginStats extends PluginStats {
    eventsTracked: number;
    conversationsRecorded: number;
    toolCallsRecorded: number;
    realTimeSyncEnabled: boolean;
    currentMode: 'agent' | 'team';
}

// Visualization data structures
export interface ConversationEvent {
    id: string;
    type: 'user_message' | 'assistant_response' | 'tool_call' | 'tool_result' | 'error';
    timestamp: Date;
    content?: string;
    toolName?: string;
    parameters?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
}

export interface AgentBlock {
    id: string;
    name: string;
    role?: string;
    status: 'idle' | 'processing' | 'waiting' | 'error';
    tools: ToolBlock[];
    plugins: PluginBlock[];
    connections: ConnectionBlock[];
}

export interface ToolBlock {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    status: 'available' | 'executing' | 'completed' | 'error';
    lastExecution?: Date;
}

export interface PluginBlock {
    name: string;
    category: PluginCategory;
    enabled: boolean;
    status: 'active' | 'inactive' | 'error';
}

export interface ConnectionBlock {
    from: string;
    to: string;
    type: 'delegation' | 'communication' | 'data_flow';
    status: 'active' | 'inactive';
}

export interface PlaygroundVisualizationData {
    mode: 'agent' | 'team';
    events: ConversationEvent[];
    agents: AgentBlock[];
    currentExecution?: {
        id: string;
        startTime: Date;
        status: 'running' | 'completed' | 'error';
    };
    stats: {
        totalEvents: number;
        totalToolCalls: number;
        averageResponseTime: number;
    };
}

/**
 * Base Plugin interface for Robota SDK compliance
 */
export abstract class BasePlugin<TOptions extends BasePluginOptions = BasePluginOptions, TStats extends PluginStats = PluginStats> {
    abstract readonly name: string;
    abstract readonly version: string;

    public enabled = true;
    public category: PluginCategory = PluginCategory.CUSTOM;
    public priority: number = PluginPriority.NORMAL;

    protected options: TOptions | undefined;
    protected logger: SimpleLogger;
    protected stats = {
        calls: 0,
        errors: 0,
        lastActivity: undefined as Date | undefined
    };

    constructor(logger?: SimpleLogger) {
        this.logger = logger || SilentLogger;
    }

    async initialize(options?: TOptions): Promise<void> {
        this.options = options;

        // Set enabled state from options
        if (options?.enabled !== undefined) {
            this.enabled = options.enabled;
        }

        // Set category from options
        if (options?.category) {
            this.category = options.category;
        }

        // Set priority from options
        if (options?.priority !== undefined) {
            this.priority = typeof options.priority === 'number' ? options.priority : options.priority;
        }

        // Handle strategy option for disable modes
        if (options?.strategy === 'silent' || options?.strategy === 'none') {
            this.enabled = false;
        }
    }

    abstract dispose(): Promise<void>;

    abstract getStats(): TStats;

    protected validateOptions(options: TOptions): void {
        // Default validation - can be overridden
        if (options && typeof options !== 'object') {
            throw new Error(`${this.name}: Invalid options - must be an object`);
        }
    }

    protected incrementCalls(): void {
        this.stats.calls++;
        this.stats.lastActivity = new Date();
    }

    protected incrementErrors(): void {
        this.stats.errors++;
        this.stats.lastActivity = new Date();
    }
}

/**
 * PlaygroundHistoryPlugin - Captures and visualizes Robota execution history
 * 
 * Follows Robota SDK Architecture Principles:
 * - Single Responsibility: History capture only
 * - Dependency Injection: Logger injection with SilentLogger default
 * - Type Safety: Proper generic types
 * - Disable Options: enabled: false, strategy: 'silent'
 */
export class PlaygroundHistoryPlugin extends BasePlugin<PlaygroundHistoryPluginOptions, PlaygroundHistoryPluginStats> {
    readonly name = 'PlaygroundHistoryPlugin';
    readonly version = '1.0.0';

    private events: ConversationEvent[] = [];
    private agents: AgentBlock[] = [];
    private mode: 'agent' | 'team' = 'agent';
    private currentExecution?: {
        id: string;
        startTime: Date;
        status: 'running' | 'completed' | 'error';
    };
    private pluginOptions: Required<PlaygroundHistoryPluginOptions>;

    constructor(options: PlaygroundHistoryPluginOptions = {}, logger?: SimpleLogger) {
        super(logger);

        // Set plugin classification
        this.category = PluginCategory.STORAGE;
        this.priority = PluginPriority.HIGH;

        // Validate options
        this.validateOptions(options);

        // Set defaults with comprehensive configuration
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            strategy: options.strategy ?? 'none',
            category: options.category ?? PluginCategory.STORAGE,
            priority: options.priority ?? PluginPriority.HIGH,
            websocketUrl: options.websocketUrl ?? '',
            enableRealTimeSync: options.enableRealTimeSync ?? false,
            maxEvents: options.maxEvents ?? 1000,
            visualizationMode: options.visualizationMode ?? 'blocks',
            logger: options.logger ?? SilentLogger,
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? true,  // Auto-subscribe to all events
            moduleEvents: options.moduleEvents ?? [
                'execution.start', 'execution.complete', 'execution.error',
                'module.execution.start', 'module.execution.complete', 'module.execution.error',
                'tool.execute.start', 'tool.execute.complete'
            ]
        };

        this.logger.info('PlaygroundHistoryPlugin initialized', {
            maxEvents: this.pluginOptions.maxEvents,
            realTimeSync: this.pluginOptions.enableRealTimeSync,
            mode: this.pluginOptions.visualizationMode
        });
    }

    async initialize(options?: PlaygroundHistoryPluginOptions): Promise<void> {
        await super.initialize(options);

        if (!this.enabled) {
            this.logger.debug('PlaygroundHistoryPlugin disabled');
            return;
        }

        try {
            this.logger.info('PlaygroundHistoryPlugin initializing');

            // Plugin initialization logic here
            this.clearHistory();

            this.logger.info('PlaygroundHistoryPlugin initialized successfully');
        } catch (error) {
            this.incrementErrors();
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
            this.logger.error('PlaygroundHistoryPlugin initialization failed:', errorMessage);
            throw new Error(`PlaygroundHistoryPlugin initialization failed: ${errorMessage}`);
        }
    }

    /**
     * Record conversation event (main plugin functionality)
     */
    recordEvent(event: Omit<ConversationEvent, 'id' | 'timestamp'>): void {
        if (!this.enabled) {
            return; // Silent when disabled
        }

        this.incrementCalls();

        try {
            const fullEvent: ConversationEvent = {
                ...event,
                id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date()
            };

            this.events.push(fullEvent);

            // Enforce max events limit
            if (this.events.length > this.pluginOptions.maxEvents) {
                this.events.shift(); // Remove oldest event
            }

            this.logger.debug('Event recorded:', {
                type: fullEvent.type,
                id: fullEvent.id
            });

        } catch (error) {
            this.incrementErrors();
            this.logger.error('Failed to record event:', error);
        }
    }

    /**
     * Set current mode (agent or team)
     */
    setMode(mode: 'agent' | 'team'): void {
        if (!this.enabled) return;

        this.mode = mode;
        this.logger.debug('Mode changed to:', mode);
    }

    /**
     * Get visualization data
     */
    getVisualizationData(): PlaygroundVisualizationData {
        const totalToolCalls = this.events.filter(e => e.type === 'tool_call').length;
        const totalEvents = this.events.length;

        // Calculate average response time
        let totalResponseTime = 0;
        let responseCount = 0;

        for (let i = 0; i < this.events.length - 1; i++) {
            const current = this.events[i];
            const next = this.events[i + 1];

            if (current.type === 'user_message' && next.type === 'assistant_response') {
                totalResponseTime += next.timestamp.getTime() - current.timestamp.getTime();
                responseCount++;
            }
        }

        const averageResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;

        return {
            mode: this.mode,
            events: [...this.events],
            agents: [...this.agents],
            currentExecution: this.currentExecution,
            stats: {
                totalEvents,
                totalToolCalls,
                averageResponseTime
            }
        };
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        if (!this.enabled) return;

        this.events = [];
        this.agents = [];
        this.currentExecution = undefined;
        this.logger.debug('History cleared');
    }

    /**
     * Handle module events automatically (SDK integration)
     */
    async onModuleEvent(eventType: string, eventData: any): Promise<void> {
        if (!this.enabled) return;

        try {
            this.logger.debug('Module event received:', { eventType, eventData });

            switch (eventType) {
                case 'execution.start':
                case 'module.execution.start':
                    // Record execution start
                    this.currentExecution = {
                        id: `exec_${Date.now()}`,
                        startTime: new Date(),
                        status: 'running'
                    };
                    break;

                case 'execution.complete':
                case 'module.execution.complete':
                    // Record execution completion
                    if (this.currentExecution) {
                        this.currentExecution.status = 'completed';
                    }

                    // Try to extract response from event data
                    if (eventData && eventData.data && eventData.data.response) {
                        this.recordEvent({
                            type: 'assistant_response',
                            content: eventData.data.response,
                            metadata: {
                                executionId: this.currentExecution?.id,
                                success: true
                            }
                        });
                    }
                    break;

                case 'execution.error':
                case 'module.execution.error':
                    // Record execution error
                    if (this.currentExecution) {
                        this.currentExecution.status = 'error';
                    }

                    if (eventData && eventData.data) {
                        this.recordEvent({
                            type: 'error',
                            content: eventData.data.message || 'Execution error',
                            metadata: {
                                executionId: this.currentExecution?.id,
                                error: eventData.data
                            }
                        });
                    }
                    break;

                case 'tool.execute.start':
                    // Record tool execution start
                    if (eventData && eventData.data) {
                        this.recordEvent({
                            type: 'tool_call',
                            toolName: eventData.data.toolName,
                            parameters: eventData.data.parameters,
                            metadata: {
                                executionId: this.currentExecution?.id,
                                phase: 'start'
                            }
                        });
                    }
                    break;

                case 'tool.execute.complete':
                    // Record tool execution result
                    if (eventData && eventData.data) {
                        this.recordEvent({
                            type: 'tool_result',
                            toolName: eventData.data.toolName,
                            content: eventData.data.result ? JSON.stringify(eventData.data.result) : '',
                            metadata: {
                                executionId: this.currentExecution?.id,
                                phase: 'complete',
                                success: eventData.data.success !== false
                            }
                        });
                    }
                    break;
            }

        } catch (error) {
            this.incrementErrors();
            this.logger.error('Failed to handle module event:', error);
        }
    }

    /**
     * Get plugin statistics
     */
    getStats(): PlaygroundHistoryPluginStats {
        const toolCallsRecorded = this.events.filter(e => e.type === 'tool_call').length;
        const conversationsRecorded = this.events.filter(e => e.type === 'user_message').length;

        return {
            calls: this.stats.calls,
            errors: this.stats.errors,
            lastActivity: this.stats.lastActivity,
            eventsTracked: this.events.length,
            conversationsRecorded,
            toolCallsRecorded,
            realTimeSyncEnabled: this.pluginOptions.enableRealTimeSync,
            currentMode: this.mode
        };
    }

    /**
     * Dispose plugin resources
     */
    async dispose(): Promise<void> {
        try {
            this.logger.info('PlaygroundHistoryPlugin disposing');

            this.clearHistory();
            this.enabled = false;

            this.logger.info('PlaygroundHistoryPlugin disposed successfully');
        } catch (error) {
            this.incrementErrors();
            this.logger.error('PlaygroundHistoryPlugin disposal failed:', error);
            throw new Error(`PlaygroundHistoryPlugin disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate plugin options with actionable error messages
     */
    protected override validateOptions(options: PlaygroundHistoryPluginOptions): void {
        super.validateOptions(options);

        if (options.maxEvents !== undefined) {
            if (typeof options.maxEvents !== 'number' || options.maxEvents < 1) {
                throw new Error(`${this.name}: maxEvents must be a positive number. Got: ${options.maxEvents}. Use maxEvents: 1000 for default.`);
            }
            if (options.maxEvents > 10000) {
                throw new Error(`${this.name}: maxEvents cannot exceed 10,000 for performance reasons. Got: ${options.maxEvents}. Use a smaller number.`);
            }
        }

        if (options.visualizationMode !== undefined) {
            const validModes = ['blocks', 'timeline', 'tree'];
            if (!validModes.includes(options.visualizationMode)) {
                throw new Error(`${this.name}: visualizationMode must be one of: ${validModes.join(', ')}. Got: ${options.visualizationMode}`);
            }
        }

        if (options.websocketUrl !== undefined && options.websocketUrl !== '') {
            try {
                new URL(options.websocketUrl);
            } catch {
                throw new Error(`${this.name}: websocketUrl must be a valid URL. Got: ${options.websocketUrl}. Example: 'ws://localhost:3001'`);
            }
        }
    }
} 