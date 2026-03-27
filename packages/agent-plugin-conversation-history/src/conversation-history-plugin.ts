import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  type TUniversalMessage,
  createLogger,
  type ILogger,
  PluginError,
  type TTimerId,
  startPeriodicTask,
  stopPeriodicTask,
} from '@robota-sdk/agent-core';
import {
  IConversationHistoryPluginOptions,
  IConversationHistoryPluginStats,
  IConversationHistoryEntry,
  IHistoryStorage,
} from './types';
import {
  validateConversationHistoryOptions,
  createHistoryStorage,
  loadConversationEntry,
  savePendingConversations,
} from './conversation-history-helpers';

const DEFAULT_MAX_CONVERSATIONS = 100;
const DEFAULT_MAX_MESSAGES = 1000;
const DEFAULT_SAVE_INTERVAL_MS = 30000;

/**
 * Persists conversation history using configurable storage backends.
 *
 * Supports memory, file, and database storage strategies. Messages are
 * automatically trimmed to {@link IConversationHistoryPluginOptions.maxMessagesPerConversation | maxMessagesPerConversation}.
 * When {@link IConversationHistoryPluginOptions.autoSave | autoSave} is
 * disabled, changes are batched and flushed on a timer.
 *
 * @extends AbstractPlugin
 * @see IHistoryStorage - storage backend contract
 * @see IConversationHistoryPluginOptions - configuration options
 *
 * @example
 * ```ts
 * const plugin = new ConversationHistoryPlugin({
 *   storage: 'memory',
 *   maxMessagesPerConversation: 500,
 * });
 * await plugin.startConversation('conv-1');
 * await plugin.addMessage({ role: 'user', content: 'Hello' });
 * ```
 */
export class ConversationHistoryPlugin extends AbstractPlugin<
  IConversationHistoryPluginOptions,
  IConversationHistoryPluginStats
> {
  name = 'ConversationHistoryPlugin';
  version = '1.0.0';

  private storage: IHistoryStorage;
  private pluginOptions: Required<IConversationHistoryPluginOptions>;
  private logger: ILogger;
  private currentConversationId?: string;
  private batchSaveTimer?: TTimerId;
  private pendingSaves = new Set<string>();

  constructor(options: IConversationHistoryPluginOptions) {
    super();
    this.logger = createLogger('ConversationHistoryPlugin');

    // Set plugin classification
    this.category = PluginCategory.STORAGE;
    this.priority = PluginPriority.HIGH;

    // Validate options
    validateConversationHistoryOptions(options);

    // Set defaults
    this.pluginOptions = {
      enabled: options.enabled ?? true,
      storage: options.storage,
      maxConversations: options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS,
      maxMessagesPerConversation: options.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES,
      filePath: options.filePath ?? './conversations.json',
      connectionString: options.connectionString ?? '',
      autoSave: options.autoSave ?? true,
      saveInterval: options.saveInterval ?? DEFAULT_SAVE_INTERVAL_MS,
      // Add plugin options defaults
      category: options.category ?? PluginCategory.STORAGE,
      priority: options.priority ?? PluginPriority.HIGH,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
    };

    // Initialize storage
    this.storage = createHistoryStorage(
      this.pluginOptions.storage,
      this.pluginOptions.maxConversations,
      this.pluginOptions.filePath,
      this.pluginOptions.connectionString,
    );

    // Setup batch saving if not auto-saving
    if (!this.pluginOptions.autoSave) {
      this.setupBatchSaving();
    }

    this.logger.info('ConversationHistoryPlugin initialized', {
      storage: this.pluginOptions.storage,
      maxConversations: this.pluginOptions.maxConversations,
      autoSave: this.pluginOptions.autoSave,
    });
  }

  /**
   * Creates a new conversation entry and persists it (or queues for batch save).
   * @throws PluginError if the storage write fails
   */
  async startConversation(conversationId: string): Promise<void> {
    try {
      this.currentConversationId = conversationId;

      const entry: IConversationHistoryEntry = {
        conversationId,
        messages: [],
        startTime: new Date(),
        lastUpdated: new Date(),
        metadata: {},
      };

      if (this.pluginOptions.autoSave) {
        await this.storage.save(conversationId, entry);
      } else {
        this.pendingSaves.add(conversationId);
      }

      this.logger.debug('Started new conversation', { conversationId });
    } catch (error) {
      throw new PluginError('Failed to start conversation', this.name, {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Appends a message to the active conversation, trimming to the maximum
   * message limit if exceeded.
   * @throws PluginError if no conversation is active or the storage write fails
   */
  async addMessage(message: TUniversalMessage): Promise<void> {
    if (!this.currentConversationId) {
      throw new PluginError('No active conversation', this.name);
    }

    try {
      const entry = (await this.storage.load(this.currentConversationId)) || {
        conversationId: this.currentConversationId,
        messages: [],
        startTime: new Date(),
        lastUpdated: new Date(),
        metadata: {},
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
        messageLength: message.content?.length ?? 0,
      });
    } catch (error) {
      throw new PluginError('Failed to add message to conversation', this.name, {
        conversationId: this.currentConversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load conversation history
   */
  async loadConversation(conversationId: string): Promise<IConversationHistoryEntry | undefined> {
    return loadConversationEntry(this.storage, conversationId, this.name, this.logger);
  }

  /**
   * Get conversation history as messages
   */
  async getHistory(conversationId: string): Promise<TUniversalMessage[]> {
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
      throw new PluginError('Failed to list conversations', this.name, {
        error: error instanceof Error ? error.message : String(error),
      });
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
      throw new PluginError('Failed to delete conversation', this.name, {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
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
      throw new PluginError('Failed to clear conversations', this.name, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Persists all conversations queued since the last save (batch mode only).
   * Individual save failures are logged but do not abort the remaining saves.
   */
  async savePending(): Promise<void> {
    await savePendingConversations(this.storage, this.pendingSaves, this.name, this.logger);
  }

  /**
   * Stops the batch-save timer and flushes any pending conversation saves.
   */
  async destroy(): Promise<void> {
    try {
      stopPeriodicTask(this.batchSaveTimer);
      this.batchSaveTimer = undefined;

      // Save any pending conversations
      await this.savePending();

      this.logger.info('ConversationHistoryPlugin destroyed');
    } catch (error) {
      this.logger.error('Error during plugin cleanup', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Setup batch saving timer
   */
  private setupBatchSaving(): void {
    this.batchSaveTimer = startPeriodicTask(
      this.logger,
      {
        name: 'ConversationHistoryPlugin.savePending',
        intervalMs: this.pluginOptions.saveInterval,
      },
      async () => {
        await this.savePending();
      },
    );
  }
}
