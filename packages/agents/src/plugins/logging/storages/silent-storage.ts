import { LogEntry, LogStorage } from '../types';

/**
 * Silent log storage (no-op)
 */
export class SilentLogStorage implements LogStorage {
    async write(_entry: LogEntry): Promise<void> {
        // Silent mode - do nothing
    }

    async flush(): Promise<void> {
        // Silent mode - do nothing
    }

    async close(): Promise<void> {
        // Silent mode - do nothing
    }
} 