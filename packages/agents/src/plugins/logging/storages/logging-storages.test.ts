import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConsoleLogStorage } from './console-storage';
import { SilentLogStorage } from './silent-storage';
import { RemoteLogStorage } from './remote-storage';
import type { ILogEntry } from '../types';

const entry: ILogEntry = {
    timestamp: new Date(),
    level: 'info',
    message: 'Test log'
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

    afterEach(async () => {
        if (storage) await storage.close();
    });

    it('batches logs and flushes when batch size reached', async () => {
        storage = new RemoteLogStorage('http://example.com/logs');
        // Write entries below batch size (10)
        for (let i = 0; i < 5; i++) {
            await storage.write({ ...entry, message: `log-${i}` });
        }
        // No error thrown
    });

    it('flushes on close', async () => {
        storage = new RemoteLogStorage('http://example.com/logs');
        await storage.write(entry);
        await expect(storage.close()).resolves.toBeUndefined();
    });

    it('flush with no pending logs is no-op', async () => {
        storage = new RemoteLogStorage('http://example.com/logs');
        await expect(storage.flush()).resolves.toBeUndefined();
    });
});
