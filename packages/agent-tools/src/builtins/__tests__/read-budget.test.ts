import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { createReadTool, ReadByteLimitError, ReadCancelledError } from '../read-tool.js';
import { InMemorySandboxClient } from '../../sandbox/in-memory-sandbox-client.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('sandbox Read rejects an oversized returned string instead of formatting it', async () => {
  const sandboxClient = new InMemorySandboxClient({
    files: { '/workspace/large.txt': `short\n${'x'.repeat(4 * 1024 * 1024)}` },
  });
  const tool = createReadTool({ cwd: '/workspace', sandboxClient });
  await expect(tool.execute({ filePath: '/workspace/large.txt', limit: 1 }))
    .rejects.toBeInstanceOf(ReadByteLimitError);
});

it('an aborted Read rejects before opening a host file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'read-cancel-'));
  roots.push(root);
  writeFileSync(join(root, 'input.txt'), 'hello');
  const controller = new AbortController();
  controller.abort();

  const tool = createReadTool({ cwd: root, signal: controller.signal });
  await expect(tool.execute({ filePath: 'input.txt' })).rejects.toBeInstanceOf(ReadCancelledError);
});
