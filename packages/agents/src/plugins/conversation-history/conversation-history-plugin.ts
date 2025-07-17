import { BasePlugin, PluginCategory, PluginPriority } from '../../abstracts/base-plugin';
import { Message } from '../../interfaces/agent';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { TimerId } from '../../utils';
import {
    ConversationHistoryPluginOptions,
    ConversationHistoryPluginStats,
    ConversationHistoryEntry,
    HistoryStorage
} from './types';
import {
    MemoryHistoryStorage,
    FileHistoryStorage,
    DatabaseHistoryStorage
} from './storages/index';

/**
 * Plugin for managing conversation history
 * Saves and loads conversation history using configurable storage strategies
 */
export class ConversationHistoryPlugin extends BasePlugin<ConversationHistoryPluginOptions, ConversationHistoryPluginStats> {
    name = 'ConversationHistoryPlugin';
    version = '1.0.0';

    private storage: HistoryStorage;
    private pluginOptions: Required<ConversationHistoryPluginOptions>;
    private logger: Logger;
    private currentConversationId?: string;
    private batchSaveTimer?: TimerId;
    private pendingSaves = new Set<string>();

    constructor(options: ConversationHistoryPluginOptions) {
        super();
        this.logger = createLogger('ConversationHistoryPlugin');

        // Set plugin classification
        this.category = PluginCategory.STORAGE;
        this.priority = PluginPriority.HIGH;

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            storage: options.storage,
            maxConversations: options.maxConversations ?? 100,
            maxMessagesPerConversation: options.maxMessagesPerConversation ?? 1000,
            filePath: options.filePath ?? './conversations.json',
            connectionString: options.connectionString ?? '',
            autoSave: options.autoSave ?? true,
            saveInterval: options.saveInterval ?? 30000, // 30 seconds
            // Add BasePluginOptions defaults
            category: options.category ?? PluginCategory.STORAGE,
            priority: options.priority ?? PluginPriority.HIGH,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
        };

        // Initialize storage
        this.storage = this.createStorage();

        // Setup batch saving if not auto-saving
        if (!this.pluginOptions.autoSave) {
            this.setupBatchSaving();
        }

        this.logger.info('ConversationHistoryPlugin initialized', {
            storage: this.pluginOptions.storage,
            maxConversations: this.pluginOptions.maxConversations,
            autoSave: this.pluginOptions.autoSave
        });
    }

    /**
     * Start a new conversation
     */
    async startConversation(conversationId: string): Promise<void> {
        try {
            this.currentConversationId = conversationId;

            const entry: ConversationHistoryEntry = {
                conversationId,
                messages: [],
                startTime: new Date(),
                lastUpdated: new Date(),
                metadata: {}
            };

            if (this.pluginOptions.autoSave) {
                await this.storage.save(conversationId, entry);
            } else {
                this.pendingSaves.add(conversationId);
            }

            this.logger.debug('Started new conversation', { conversationId });
        } catch (error) {
            throw new PluginError('Failed to start conversation', this.name, { conversationId, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Add a message to the current conversation
     */
    async addMessage(message: Message): Promise<void> {
        if (!this.currentConversationId) {
            throw new PluginError('No active conversation', this.name);
        }

        try {
            const entry = await this.storage.load(this.currentConversationId) || {
                conversationId: this.currentConversationId,
                messages: [],
                startTime: new Date(),
                lastUpdated: new Date(),
                metadata: {}
            };

            // Add message and trim if necessary
            entry.messages.push(message);
            if (entry.messages.length > this.pluginOptions.maxMessagesPerConversation) {
                entry.messages = entry.messages.slice(-this.pluginOptions.maxMessagesPerConversation);
            }
            entry.lastUpdated = new Date();

            if (this.pluginOptions.autoSave) {
                await this.storage.save(this.currentConversationId, entry);
            } else {
                this.pendingSaves.add(this.currentConversationId);
            }

            this.logger.debug('Added message to conversation', {
                conversationId: this.currentConversationId,
                messageRole: message.role,
                messageLength: message.content.length
            });
        } catch (error) {
            throw new PluginError('Failed to add message to conversation', this.name, {
                conversationId: this.currentConversationId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Load conversation history
     */
    async loadConversation(conversationId: string): Promise<ConversationHistoryEntry | undefined> {
        try {
            const entry = await this.storage.load(conversationId);
            this.logger.debug('Loaded conversation', {
                conversationId,
                found: !!entry,
                messageCount: entry?.messages.length ?? 0
            });
            return entry;
        } catch (error) {
            throw new PluginError('Failed to load conversation', this.name, { conversationId, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Get conversation history as messages
     */
    async getHistory(conversationId: string): Promise<Message[]> {
        const entry = await this.loadConversation(conversationId);
        return entry?.messages ?? [];
    }

    /**
     * List all conversation IDs
     */
    async listConversations(): Promise<string[]> {
        try {
            return await this.storage.list();
        } catch (error) {
            throw new PluginError('Failed to list conversations', this.name, { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Delete a conversation
     */
    async deleteConversation(conversationId: string): Promise<boolean> {
        try {
            const deleted = await this.storage.delete(conversationId);
            this.pendingSaves.delete(conversationId);
            this.logger.debug('Deleted conversation', { conversationId, deleted });
            return deleted;
        } catch (error) {
            throw new PluginError('Failed to delete conversation', this.name, { conversationId, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Clear all conversations
     */
    async clearAllConversations(): Promise<void> {
        try {
            await this.storage.clear();
            this.pendingSaves.clear();
            this.logger.info('Cleared all conversations');
        } catch (error) {
            throw new PluginError('Failed to clear conversations', this.name, { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Save pending conversations (for batch mode)
     */
    async savePending(): Promise<void> {
        if (this.pendingSaves.size === 0) return;

        const conversationIds = Array.from(this.pendingSaves);
        this.logger.debug('Saving pending conversations', { count: conversationIds.length });

        for (const conversationId of conversationIds) {
            try {
                const entry = await this.storage.load(conversationId);
                if (entry) {
                    await this.storage.save(conversationId, entry);
                }
                this.pendingSaves.delete(conversationId);
            } catch (error) {
                this.logger.error('Failed to save pending conversation', {
                    conversationId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        try {
            if (this.batchSaveTimer) {
                clearInterval(this.batchSaveTimer);
            }

            // Save any pending conversations
            await this.savePending();

            this.logger.info('ConversationHistoryPlugin destroyed');
        } catch (error) {
            this.logger.error('Error during plugin cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Validate plugin options
     */
    private validateOptions(options: ConversationHistoryPluginOptions): void {
        if (!options.storage) {
            throw new ConfigurationError('Storage strategy is required');
        }

        if (!['memory', 'file', 'database'].includes(options.storage)) {
            throw new ConfigurationError('Invalid storage strategy', { validStrategies: ['memory', 'file', 'database'], provided: options.storage });
        }

        if (options.storage === 'file' && !options.filePath) {
            throw new ConfigurationError('File path is required for file storage strategy');
        }

        if (options.storage === 'database' && !options.connectionString) {
            throw new ConfigurationError('Connection string is required for database storage strategy');
        }

        if (options.maxConversations !== undefined && options.maxConversations <= 0) {
            throw new ConfigurationError('Max conversations must be positive');
        }

        if (options.maxMessagesPerConversation !== undefined && options.maxMessagesPerConversation <= 0) {
            throw new ConfigurationError('Max messages per conversation must be positive');
        }
    }

    /**
     * Create storage instance based on strategy
     */
    private createStorage(): HistoryStorage {
        switch (this.pluginOptions.storage) {
            case 'memory':
                return new MemoryHistoryStorage(this.pluginOptions.maxConversations);
            case 'file':
                return new FileHistoryStorage(this.pluginOptions.filePath);
            case 'database':
                return new DatabaseHistoryStorage(this.pluginOptions.connectionString);
            default:
                throw new ConfigurationError('Unknown storage strategy', { strategy: this.pluginOptions.storage });
        }
    }

    /**
     * Setup batch saving timer
     */
    private setupBatchSaving(): void {
        this.batchSaveTimer = setInterval(async () => {
            try {
                await this.savePending();
            } catch (error) {
                this.logger.error('Error during batch save', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.pluginOptions.saveInterval);
    }
} 