import type {
    BlockDataCollector,
    BlockMessage,
    BlockMetadata,
    BlockCollectionEvent,
    BlockCollectionListener,
    BlockTreeNode,
    RealTimeBlockMessage,
    RealTimeBlockMetadata
} from './types';

/**
 * Playground-specific block collector implementation
 * Manages block collection with React state integration
 */
export class PlaygroundBlockCollector implements BlockDataCollector {
    private blocks: Map<string, BlockMessage> = new Map();
    private listeners: Set<BlockCollectionListener> = new Set();
    private rootBlocks: string[] = [];

    /**
     * Add a listener for block collection events
     */
    addListener(listener: BlockCollectionListener): void {
        this.listeners.add(listener);
    }

    /**
     * Remove a listener
     */
    removeListener(listener: BlockCollectionListener): void {
        this.listeners.delete(listener);
    }

    /**
     * Notify all listeners of an event
     */
    private notifyListeners(event: BlockCollectionEvent): void {
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('Block collection listener error:', error);
            }
        });
    }

    /**
     * Collect a new block message
     */
    collectBlock(message: BlockMessage): void {
        this.blocks.set(message.blockMetadata.id, message);

        // Track root blocks (no parent)
        if (!message.blockMetadata.parentId) {
            this.rootBlocks.push(message.blockMetadata.id);
        } else {
            // Add to parent's children
            const parent = this.blocks.get(message.blockMetadata.parentId);
            if (parent && !parent.blockMetadata.children.includes(message.blockMetadata.id)) {
                parent.blockMetadata.children.push(message.blockMetadata.id);
                this.notifyListeners({
                    type: 'block_updated',
                    blockId: parent.blockMetadata.id,
                    updates: { children: parent.blockMetadata.children }
                });
            }
        }

        this.notifyListeners({ type: 'block_added', block: message });
    }

    /**
     * Update an existing block
     */
    updateBlock(blockId: string, updates: Partial<BlockMetadata>): void {
        const block = this.blocks.get(blockId);
        if (!block) {
            console.warn(`Block not found for update: ${blockId}`);
            return;
        }

        // Merge updates into existing metadata
        Object.assign(block.blockMetadata, updates);

        this.notifyListeners({ type: 'block_updated', blockId, updates });
    }

    /**
     * Update a block's metadata in real-time
     */
    updateRealTimeBlock(blockId: string, updates: Partial<RealTimeBlockMetadata>): void {
        const block = this.blocks.get(blockId);
        if (!block) {
            console.warn(`Block not found for real-time update: ${blockId}`);
            return;
        }

        // Merge updates into existing metadata
        Object.assign(block.blockMetadata, updates);

        this.notifyListeners({ type: 'block_updated', blockId, updates });
    }

    /**
     * Get all collected blocks
     */
    getBlocks(): BlockMessage[] {
        return Array.from(this.blocks.values());
    }

    /**
     * Get blocks by parent ID for hierarchical rendering
     */
    getBlocksByParent(parentId?: string): BlockMessage[] {
        if (!parentId) {
            // Return root blocks
            return this.rootBlocks
                .map(id => this.blocks.get(id))
                .filter((block): block is BlockMessage => block !== undefined);
        }

        const parent = this.blocks.get(parentId);
        if (!parent) {
            return [];
        }

        return parent.blockMetadata.children
            .map(childId => this.blocks.get(childId))
            .filter((block): block is BlockMessage => block !== undefined);
    }

    /**
     * Build block tree for hierarchical visualization
     */
    getBlockTree(): BlockTreeNode[] {
        const buildNode = (blockId: string, parent?: BlockTreeNode): BlockTreeNode => {
            const block = this.blocks.get(blockId);
            if (!block) {
                throw new Error(`Block not found: ${blockId}`);
            }

            const node: BlockTreeNode = {
                block,
                children: [],
                parent
            };

            // Build children recursively
            node.children = block.blockMetadata.children.map(childId =>
                buildNode(childId, node)
            );

            return node;
        };

        return this.rootBlocks.map(rootId => buildNode(rootId));
    }

    /**
     * Clear all blocks
     */
    clearBlocks(): void {
        this.blocks.clear();
        this.rootBlocks = [];
        this.notifyListeners({ type: 'blocks_cleared' });
    }

    /**
     * Generate unique block ID
     */
    generateBlockId(): string {
        return `block_${crypto.randomUUID()}`;
    }

    /**
     * Get block by ID
     */
    getBlock(blockId: string): BlockMessage | undefined {
        return this.blocks.get(blockId);
    }

    /**
     * Remove a block and its children
     */
    removeBlock(blockId: string): void {
        const block = this.blocks.get(blockId);
        if (!block) {
            return;
        }

        // Remove children recursively
        block.blockMetadata.children.forEach(childId => {
            this.removeBlock(childId);
        });

        // Remove from parent's children list
        if (block.blockMetadata.parentId) {
            const parent = this.blocks.get(block.blockMetadata.parentId);
            if (parent) {
                parent.blockMetadata.children = parent.blockMetadata.children.filter(
                    id => id !== blockId
                );
                this.notifyListeners({
                    type: 'block_updated',
                    blockId: parent.blockMetadata.id,
                    updates: { children: parent.blockMetadata.children }
                });
            }
        } else {
            // Remove from root blocks
            this.rootBlocks = this.rootBlocks.filter(id => id !== blockId);
        }

        // Remove the block itself
        this.blocks.delete(blockId);
        this.notifyListeners({ type: 'block_removed', blockId });
    }

    /**
     * Create a group block that can contain other blocks
     */
    createGroupBlock(
        type: 'user' | 'assistant' | 'tool_call' | 'group',
        content: string,
        parentId?: string,
        level: number = 0
    ): BlockMessage {
        const blockId = this.generateBlockId();

        const groupBlock: BlockMessage = {
            role: 'system',
            content,
            blockMetadata: {
                id: blockId,
                type,
                level,
                parentId,
                children: [],
                isExpanded: true,
                visualState: 'pending',
                executionContext: {
                    timestamp: new Date()
                }
            }
        };

        this.collectBlock(groupBlock);
        return groupBlock;
    }

    /**
     * Get statistics about collected blocks
     */
    getStats() {
        const blocks = this.getBlocks();
        const byType = blocks.reduce((acc, block) => {
            const type = block.blockMetadata.type;
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byState = blocks.reduce((acc, block) => {
            const state = block.blockMetadata.visualState;
            acc[state] = (acc[state] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            total: blocks.length,
            byType,
            byState,
            rootBlocks: this.rootBlocks.length
        };
    }
} 