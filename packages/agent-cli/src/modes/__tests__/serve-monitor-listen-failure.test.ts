import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>();
  return {
    ...actual,
    createServer: () => {
      const server = new EventEmitter();
      return Object.assign(server, {
        listen: () => {
          queueMicrotask(() => server.emit('error', new Error('fixture listen failure')));
          return server;
        },
      });
    },
  };
});

import { startMonitorUiServer } from '../serve-monitor-ui.js';

it('rejects a listener failure so the caller can clean up startup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'monitor-listen-'));
  try {
    await expect(
      startMonitorUiServer(directory, 'ws://127.0.0.1:1?token=dummy', createTestProductRuntime()),
    ).rejects.toThrow('fixture listen failure');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
