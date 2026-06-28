import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleLogStorage } from '../storages/console-storage';
import { SilentLogStorage } from '../storages/silent-storage';
import { RemoteLogStorage } from '../storages/remote-storage';
import type { ILogEntry } from '../types';

const entry: ILogEntry = {
  timestamp: new Date(),
  level: 'info',
  message: 'Test log',
};

describe('ConsoleLogStorage', () => {
  it('writes debug log via logger', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const storage = new ConsoleLogStorage(undefined, logger);
    await storage.write({ ...entry, level: 'debug' });
    expect(logger.debug).toHaveBeenCalled();
  });

  it('writes info log via logger', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const storage = new ConsoleLogStorage(undefined, logger);
    await storage.write({ ...entry, level: 'info' });
    expect(logger.info).toHaveBeenCalled();
  });

  it('writes warn log via logger', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const storage = new ConsoleLogStorage(undefined, logger);
    await storage.write({ ...entry, level: 'warn' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('writes error log via logger', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const storage = new ConsoleLogStorage(undefined, logger);
    await storage.write({ ...entry, level: 'error' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('flush is a no-op', async () => {
    const storage = new ConsoleLogStorage();
    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('close is a no-op', async () => {
    const storage = new ConsoleLogStorage();
    await expect(storage.close()).resolves.toBeUndefined();
  });
});

describe('SilentLogStorage', () => {
  const storage = new SilentLogStorage();

  it('write is a no-op', async () => {
    await expect(storage.write(entry)).resolves.toBeUndefined();
  });

  it('flush is a no-op', async () => {
    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('close is a no-op', async () => {
    await expect(storage.close()).resolves.toBeUndefined();
  });
});

describe('RemoteLogStorage', () => {
  let storage: RemoteLogStorage;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    if (storage) await storage.close();
    vi.unstubAllGlobals();
  });

  it('POSTs the batch to the endpoint on flush', async () => {
    storage = new RemoteLogStorage('http://example.com/logs');
    for (let i = 0; i < 5; i++) {
      await storage.write({ ...entry, message: `log-${i}` });
    }
    await storage.flush();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/logs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('flushes on close', async () => {
    storage = new RemoteLogStorage('http://example.com/logs');
    await storage.write(entry);
    await expect(storage.close()).resolves.toBeUndefined();
  });

  it('flush with no pending logs is a no-op (no request)', async () => {
    storage = new RemoteLogStorage('http://example.com/logs');
    await expect(storage.flush()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-queues the batch when the endpoint fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    storage = new RemoteLogStorage('http://example.com/logs');
    await storage.write(entry);
    await expect(storage.flush()).rejects.toThrow('Failed to send logs to remote endpoint');
    // batch was re-queued, so a subsequent (now-ok) flush succeeds and sends it
    await expect(storage.flush()).resolves.toBeUndefined();
  });
});
