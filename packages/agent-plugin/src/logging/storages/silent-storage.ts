import type { ILogEntry, ILogStorage } from '../types';

/**
 * Silent log storage (no-op)
 */
export class SilentLogStorage implements ILogStorage {
  async write(_entry: ILogEntry): Promise<void> {
    // Silent mode - do nothing
  }

  async flush(): Promise<void> {
    // Silent mode - do nothing
  }

  async close(): Promise<void> {
    // Silent mode - do nothing
  }
}
