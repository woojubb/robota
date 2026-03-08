const UPDATE_STATE_DELAY_MS = 100;

import { useRef, useEffect, useState, useCallback } from 'react';
import {
    PlaygroundBlockCollector,
    type IPlaygroundBlockCollector,
    type IBlockMessage,
    type TBlockCollectionEvent
} from '../lib/playground/block-tracking';
import { UniversalToolFactory } from '../lib/playground/universal-tool-factory';
import type { IToolSchema, ILogger, TToolExecutor, TUniversalValue } from '@robota-sdk/agents';

/**
 * Options for useBlockTracking hook
 */
export interface IUseBlockTrackingOptions {
    /** Logger for block tracking operations */
    logger?: ILogger;

    /** Whether to enable real-time updates */
    enableRealTime?: boolean;

    /** Whether to auto-clear blocks on execution start */
    autoClearOnStart?: boolean;
}

/**
 * Block tracking hook result
 */
export interface IUseBlockTrackingResult {
    /** Block collector instance */
    blockCollector: IPlaygroundBlockCollector;

    /** Universal tool factory for creating tracked tools */
    toolFactory: UniversalToolFactory;

    /** Current blocks */
    blocks: IBlockMessage[];

    /** Block statistics */
    stats: ReturnType<IPlaygroundBlockCollector['getStats']>;

    /** Clear all blocks */
    clearBlocks: () => void;

    /** Whether blocks are being updated */
    isUpdating: boolean;

    /** Last update timestamp */
    lastUpdate: Date | null;
}

/**
 * React hook for managing block tracking in Playground
 * Provides centralized block collection and tool factory management
 */
export function useBlockTracking(options: IUseBlockTrackingOptions = {}): IUseBlockTrackingResult {
    const {
        logger,
        enableRealTime = true,
        autoClearOnStart = false
    } = options;

    // Stable references
    const blockCollectorRef = useRef<IPlaygroundBlockCollector | null>(null);
    const toolFactoryRef = useRef<UniversalToolFactory | null>(null);

    // State
    const [blocks, setBlocks] = useState<IBlockMessage[]>([]);
    const [stats, setStats] = useState(() => ({
        total: 0,
        byType: {},
        byState: {},
        rootBlocks: 0
    }));
    const [isUpdating, setIsUpdating] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Initialize instances
    useEffect(() => {
        if (!blockCollectorRef.current) {
            blockCollectorRef.current = new PlaygroundBlockCollector();
        }

        if (!toolFactoryRef.current) {
            toolFactoryRef.current = new UniversalToolFactory({
                blockCollector: blockCollectorRef.current,
                logger
            });
        }

    }, [logger]);

    // Update blocks and stats
    const updateState = useCallback(() => {
        if (!blockCollectorRef.current) return;

        setIsUpdating(true);

        const newBlocks = blockCollectorRef.current.getBlocks();
        const newStats = blockCollectorRef.current.getStats();

        setBlocks(newBlocks);
        setStats(newStats);
        setLastUpdate(new Date());

        // Small delay to show updating state
        setTimeout(() => setIsUpdating(false), UPDATE_STATE_DELAY_MS);
    }, []);

    // Listen to block events
    useEffect(() => {
        if (!blockCollectorRef.current || !enableRealTime) return;

        const handleBlockEvent = (_event: TBlockCollectionEvent) => {
            updateState();
        };

        blockCollectorRef.current.addListener(handleBlockEvent);

        // Initial update
        updateState();

        return () => {
            blockCollectorRef.current?.removeListener(handleBlockEvent);
        };
    }, [enableRealTime, updateState]);

    // Clear blocks function
    const clearBlocks = useCallback(() => {
        if (blockCollectorRef.current) {
            blockCollectorRef.current.clearBlocks();
        }
    }, []);

    // Auto-clear on start if enabled
    useEffect(() => {
        if (autoClearOnStart) {
            clearBlocks();
        }
    }, [autoClearOnStart, clearBlocks]);

    return {
        blockCollector: blockCollectorRef.current!,
        toolFactory: toolFactoryRef.current!,
        blocks,
        stats,
        clearBlocks,
        isUpdating,
        lastUpdate
    };
}

/**
 * Hook for creating tracked tools easily
 */
export function useTrackedTools(blockTracking: IUseBlockTrackingResult) {
    const { toolFactory } = blockTracking;

    const createFunctionTool = useCallback((schema: IToolSchema, executor: TToolExecutor, options: { parentBlockId?: string; level?: number; logger?: ILogger } = {}) => {
        return toolFactory.createFunctionTool(schema, executor, options);
    }, [toolFactory]);

    const createOpenAPITool = useCallback((config: Record<string, TUniversalValue>, options: { parentBlockId?: string; level?: number; logger?: ILogger } = {}) => {
        return toolFactory.createOpenAPITool(config, options);
    }, [toolFactory]);

    const createMCPTool = useCallback((config: Record<string, TUniversalValue>, schema: Record<string, TUniversalValue>, options: { parentBlockId?: string; level?: number; logger?: ILogger } = {}) => {
        return toolFactory.createMCPTool(config, schema, options);
    }, [toolFactory]);

    const createDelegationTool = useCallback((teamContainer: Record<string, TUniversalValue>, templates: Array<Record<string, TUniversalValue>>, options: { parentBlockId?: string; level?: number; logger?: ILogger } = {}) => {
        return toolFactory.createDelegationTool(teamContainer, templates, options);
    }, [toolFactory]);

    return {
        createFunctionTool,
        createOpenAPITool,
        createMCPTool,
        createDelegationTool
    };
}

/**
 * Hook for team operations with block tracking
 */
// Team tracking hooks removed (team feature removed)