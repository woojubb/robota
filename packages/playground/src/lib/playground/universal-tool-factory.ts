import {
    FunctionTool,
    type IToolSchema,
    type TToolExecutor,
    type SimpleLogger,
    SilentLogger,
} from '@robota-sdk/agents';
import type { TUniversalValue } from '@robota-sdk/agents';
import { WebLogger } from '../web-logger';
import type {
    IBlockDataCollector,
    IToolHooks
} from './block-tracking';
import {
    createBlockTrackingHooks,
    createDelegationTrackingHooks
} from './block-tracking';

/**
 * Universal Tool Factory options
 */
export interface IUniversalToolFactoryOptions {
    /** Block collector for tracking tool executions */
    blockCollector: IBlockDataCollector;

    /** Logger for tool execution */
    logger?: SimpleLogger;
}

/**
 * Universal Tool Factory
 * Provides a unified interface for creating any type of tool with automatic block tracking
 * Leverages the universal Hook system from @robota-sdk/agents
 */
export class UniversalToolFactory {
    private readonly blockCollector: IBlockDataCollector;
    private readonly logger: SimpleLogger;

    constructor(options: IUniversalToolFactoryOptions) {
        this.blockCollector = options.blockCollector;
        this.logger = options.logger ?? SilentLogger;
    }

    /**
     * Create FunctionTool with block tracking
     */
    createFunctionTool(
        schema: IToolSchema,
        executor: TToolExecutor,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): FunctionTool {
        // Block tracking hooks are handled in the Playground execution layer.
        return new FunctionTool(schema, executor, { logger: options.logger ?? this.logger });
    }

    /**
     * Create OpenAPITool with block tracking
     * Note: OpenAPITool not available in current SDK version
     */
    createOpenAPITool(
        _config: Record<string, TUniversalValue>,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): null {
        const logger = this.logger ?? WebLogger;
        logger.warn('OpenAPITool not available in current SDK version');
        return null;
    }

    /**
     * Create MCPTool with block tracking
     * Note: MCPTool not available in current SDK version
     */
    createMCPTool(
        _config: Record<string, TUniversalValue>,
        _schema: Record<string, TUniversalValue>,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): null {
        const logger = this.logger ?? WebLogger;
        logger.warn('MCPTool not available in current SDK version');
        return null;
    }

    /**
     * Create AgentDelegationTool with delegation tracking
     * Note: AgentDelegationTool not available in current SDK version
     */
    createDelegationTool(
        _teamContainer: Record<string, TUniversalValue>,
        _availableTemplates: Array<Record<string, TUniversalValue>>,
        options: {
            parentBlockId?: string;
            level?: number;
            logger?: SimpleLogger;
        } = {}
    ): null {
        const logger = this.logger ?? WebLogger;
        logger.warn('AgentDelegationTool not available in current SDK version');
        return null;
    }

    /**
     * Get block collector for direct access
     */
    getBlockCollector(): IBlockDataCollector {
        return this.blockCollector;
    }
} 