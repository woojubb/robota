import { useRef, useEffect, useState, useCallback } from 'react';
import {
    PlaygroundBlockCollector,
    type BlockDataCollector,
    type BlockMessage,
    type BlockCollectionEvent
} from '../lib/playground/block-tracking';
import { UniversalToolFactory } from '../lib/playground/universal-tool-factory';
import type { SimpleLogger } from '@robota-sdk/agents';

/**
 * Options for useBlockTracking hook
 */
export interface UseBlockTrackingOptions {
    /** Logger for block tracking operations */
    logger?: SimpleLogger;

    /** Whether to enable real-time updates */
    enableRealTime?: boolean;

    /** Whether to auto-clear blocks on execution start */
    autoClearOnStart?: boolean;
}

/**
 * Block tracking hook result
 */
export interface UseBlockTrackingResult {
    /** Block collector instance */
    blockCollector: PlaygroundBlockCollector;

    /** Universal tool factory for creating tracked tools */
    toolFactory: UniversalToolFactory;

    /** Current blocks */
    blocks: BlockMessage[];

    /** Block statistics */
    stats: ReturnType<PlaygroundBlockCollector['getStats']>;

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
export function useBlockTracking(options: UseBlockTrackingOptions = {}): UseBlockTrackingResult {
    const {
        logger,
        enableRealTime = true,
        autoClearOnStart = false
    } = options;

    // Stable references
    const blockCollectorRef = useRef<PlaygroundBlockCollector | null>(null);
    const toolFactoryRef = useRef<UniversalToolFactory | null>(null);

    // State
    const [blocks, setBlocks] = useState<BlockMessage[]>([]);
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
        setTimeout(() => setIsUpdating(false), 100);
    }, []);

    // Listen to block events
    useEffect(() => {
        if (!blockCollectorRef.current || !enableRealTime) return;

        const handleBlockEvent = (event: BlockCollectionEvent) => {
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
export function useTrackedTools(blockTracking: UseBlockTrackingResult) {
    const { toolFactory } = blockTracking;

    const createFunctionTool = useCallback((schema: any, executor: any, options: any = {}) => {
        return toolFactory.createFunctionTool(schema, executor, options);
    }, [toolFactory]);

    const createOpenAPITool = useCallback((config: any, options: any = {}) => {
        return toolFactory.createOpenAPITool(config, options);
    }, [toolFactory]);

    const createMCPTool = useCallback((config: any, schema: any, options: any = {}) => {
        return toolFactory.createMCPTool(config, schema, options);
    }, [toolFactory]);

    const createDelegationTool = useCallback((teamContainer: any, templates: any[], options: any = {}) => {
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