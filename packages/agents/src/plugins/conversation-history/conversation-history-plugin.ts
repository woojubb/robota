import { BasePlugin } from '../../abstracts/base-plugin';
import { Message } from '../../interfaces/agent';
import { Logger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import {
    ConversationHistoryPluginOptions,
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
export class ConversationHistoryPlugin extends BasePlugin {
    name = 'ConversationHistoryPlugin';
    version = '1.0.0';

    private storage: HistoryStorage;
    private options: Required<ConversationHistoryPluginOptions>;
    private logger: Logger;
    private currentConversationId?: string;
    private batchSaveTimer?: NodeJS.Timeout;
    private pendingSaves = new Set<string>();

    constructor(options: ConversationHistoryPluginOptions) {
        super();
        this.logger = new Logger('ConversationHistoryPlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.options = {
            storage: options.storage,
            maxConversations: options.maxConversations ?? 100,
            maxMessagesPerConversation: options.maxMessagesPerConversation ?? 1000,
            filePath: options.filePath ?? './conversations.json',
            connectionString: options.connectionString ?? '',
            autoSave: options.autoSave ?? true,
            saveInterval: options.saveInterval ?? 30000, // 30 seconds
        };

        // Initialize storage
        this.storage = this.createStorage();

        // Setup batch saving if not auto-saving
        if (!this.options.autoSave) {
            this.setupBatchSaving();
        }

        this.logger.info('ConversationHistoryPlugin initialized', {
            storage: this.options.storage,
            maxConversations: this.options.maxConversations,
            autoSave: this.options.autoSave
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

            if (this.options.autoSave) {
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
            if (entry.messages.length > this.options.maxMessagesPerConversation) {
                entry.messages = entry.messages.slice(-this.options.maxMessagesPerConversation);
            }
            entry.lastUpdated = new Date();

            if (this.options.autoSave) {
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
                this.logger.error('Failed to save pending conversation', { conversationId, error });
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
            this.logger.error('Error during plugin cleanup', { error });
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
        switch (this.options.storage) {
            case 'memory':
                return new MemoryHistoryStorage(this.options.maxConversations);
            case 'file':
                return new FileHistoryStorage(this.options.filePath);
            case 'database':
                return new DatabaseHistoryStorage(this.options.connectionString);
            default:
                throw new ConfigurationError('Unknown storage strategy', { strategy: this.options.storage });
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
                this.logger.error('Error during batch save', { error });
            }
        }, this.options.saveInterval);
    }
} 