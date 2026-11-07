import { describe, expect, it } from 'vitest';

import { ConversationHistoryPlugin } from '../../conversation-history/conversation-history-plugin';
import { FileHistoryStorage } from '../../conversation-history/storages/file-storage';
import { LoggingPlugin } from '../../logging/logging-plugin';
import { FileLogStorage } from '../../logging/storages/file-storage';
import { UsagePlugin } from '../../usage/usage-plugin';
import { FileUsageStorage } from '../../usage/storages/file-storage';
import type { IPluginTextFileStore } from '../text-file-store';

/** A store over a Map: nothing here touches a file system, so the storages cannot either. */
function memoryStore(): IPluginTextFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readText: async (path) => files.get(path),
    writeText: async (path, text) => {
      files.set(path, text);
    },
    appendText: async (path, text) => {
      files.set(path, (files.get(path) ?? '') + text);
    },
  };
}

describe('file storages through an injected IPluginTextFileStore', () => {
  it('FileHistoryStorage reads and writes only through the store', async () => {
    const store = memoryStore();
    const storage = new FileHistoryStorage('history.json', store);
    expect(await storage.list()).toEqual([]);
    await storage.save('c1', {
      conversationId: 'c1',
      messages: [],
      startTime: new Date('2026-06-01T00:00:00.000Z'),
      lastUpdated: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(Object.keys(JSON.parse(store.files.get('history.json')!))).toEqual(['c1']);
    expect((await storage.load('c1'))?.startTime).toBeInstanceOf(Date);
  });

  it('FileUsageStorage reads and writes only through the store', async () => {
    const store = memoryStore();
    const storage = new FileUsageStorage('usage.json', store);
    await storage.save({
      conversationId: 'c1',
      timestamp: new Date('2026-06-01T00:00:00.000Z'),
      provider: 'p',
      model: 'm',
      tokensUsed: { input: 1, output: 1, total: 2 },
      requestCount: 1,
      duration: 1,
      success: true,
    });
    expect(JSON.parse(store.files.get('usage.json')!)).toHaveLength(1);
    expect(await storage.getStats()).toHaveLength(1);
  });

  it('FileLogStorage appends through the store', async () => {
    const store = memoryStore();
    const storage = new FileLogStorage('app.log', store);
    const timestamp = new Date('2026-06-01T00:00:00.000Z');
    await storage.write({ timestamp, level: 'info', message: 'one' });
    await storage.write({ timestamp, level: 'info', message: 'two' });
    expect(store.files.get('app.log')!.trim().split('\n')).toHaveLength(2);
  });

  it('wraps a store failure the way a file failure was wrapped', async () => {
    const failing: IPluginTextFileStore = {
      readText: async () => {
        throw new Error('boom');
      },
      writeText: async () => {
        throw new Error('boom');
      },
      appendText: async () => {
        throw new Error('boom');
      },
    };
    await expect(new FileHistoryStorage('h.json', failing).list()).rejects.toThrow(
      'Failed to list conversations from file',
    );
    await expect(
      new FileLogStorage('a.log', failing).write({
        timestamp: new Date(),
        level: 'info',
        message: 'x',
      }),
    ).rejects.toThrow('Failed to write log to file');
  });

  it('the plugins hand their injected store to the file storage', async () => {
    const store = memoryStore();
    const history = new ConversationHistoryPlugin({
      storage: 'file',
      filePath: 'history.json',
      fileStore: store,
    });
    await history.startConversation('c1');
    expect(store.files.has('history.json')).toBe(true);

    const usage = new UsagePlugin({
      strategy: 'file',
      filePath: 'usage.json',
      fileStore: store,
      aggregateStats: false,
    });
    await usage.recordUsage({
      provider: 'p',
      model: 'm',
      tokensUsed: { input: 1, output: 1, total: 2 },
      requestCount: 1,
      duration: 1,
      success: true,
    });
    expect(store.files.has('usage.json')).toBe(true);

    const logging = new LoggingPlugin({ strategy: 'file', filePath: 'app.log', fileStore: store });
    await logging.info('hello');
    expect(store.files.get('app.log')).toContain('hello');

    await Promise.all([history.dispose(), usage.dispose(), logging.dispose()]);
  });
});
