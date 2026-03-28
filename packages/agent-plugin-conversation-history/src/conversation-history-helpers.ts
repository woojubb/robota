/**
 * Conversation History Plugin - Validation and storage factory helpers.
 *
 * Extracted from conversation-history-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { ConfigurationError, PluginError, type ILogger } from '@robota-sdk/agent-core';
import { MemoryHistoryStorage, FileHistoryStorage, DatabaseHistoryStorage } from './storages/index';
import type {
  IConversationHistoryPluginOptions,
  IHistoryStorage,
  IConversationHistoryEntry,
} from './types';

/** Validate ConversationHistoryPlugin constructor options. @internal */
export function validateConversationHistoryOptions(
  options: IConversationHistoryPluginOptions,
): void {
  if (!options.storage) {
    throw new ConfigurationError('Storage strategy is required');
  }

  if (!['memory', 'file', 'database'].includes(options.storage)) {
    throw new ConfigurationError('Invalid storage strategy', {
      validStrategies: ['memory', 'file', 'database'],
      provided: options.storage,
    });
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
 * Load a conversation entry from storage with error wrapping. @internal
 */
export async function loadConversationEntry(
  storage: IHistoryStorage,
  conversationId: string,
  pluginName: string,
  logger: ILogger,
): Promise<IConversationHistoryEntry | undefined> {
  try {
    const entry = await storage.load(conversationId);
    logger.debug('Loaded conversation', {
      conversationId,
      found: !!entry,
      messageCount: entry?.messages.length ?? 0,
    });
    return entry;
  } catch (error) {
    throw new PluginError('Failed to load conversation', pluginName, {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Flush all pending conversation saves to storage, logging individual failures. @internal
 */
export async function savePendingConversations(
  storage: IHistoryStorage,
  pendingSaves: Set<string>,
  pluginName: string,
  logger: ILogger,
): Promise<void> {
  if (pendingSaves.size === 0) return;

  const conversationIds = Array.from(pendingSaves);
  logger.debug('Saving pending conversations', { count: conversationIds.length });

  for (const conversationId of conversationIds) {
    try {
      const entry = await storage.load(conversationId);
      if (entry) {
        await storage.save(conversationId, entry);
      }
      pendingSaves.delete(conversationId);
    } catch (error) {
      logger.error('Failed to save pending conversation', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Create IHistoryStorage instance for the given strategy. @internal */
export function createHistoryStorage(
  strategy: string,
  maxConversations: number,
  filePath: string,
  connectionString: string,
): IHistoryStorage {
  switch (strategy) {
    case 'memory':
      return new MemoryHistoryStorage(maxConversations);
    case 'file':
      return new FileHistoryStorage(filePath);
    case 'database':
      return new DatabaseHistoryStorage(connectionString);
    default:
      throw new ConfigurationError('Unknown storage strategy', { strategy });
  }
}
