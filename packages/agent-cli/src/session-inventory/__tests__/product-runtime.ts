import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** One explicit, disposable product state root per test; no shared durable user state. */
export function createInventoryRuntime() {
  root ??= mkdtempSync(join(tmpdir(), 'iv-'));
  return createTestProductRuntime('test-product', {
    PRODUCT_USER_STATE_DIR: root,
    PRODUCT_CACHE_DIR: join(root, 'cache'),
    PRODUCT_LOG_DIR: join(root, 'logs'),
    HOME: process.env['HOME'],
  });
}
