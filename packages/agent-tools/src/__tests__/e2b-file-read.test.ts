import { describe, expect, it, vi } from 'vitest';

import { E2BSandboxClient } from '../index.js';

import type { IE2BSandboxAdapter } from '../index.js';

function adapterReading(content: string | Uint8Array): IE2BSandboxAdapter {
  return {
    commands: { run: vi.fn(async () => ({ stdout: '', exitCode: 0 })) },
    files: { read: vi.fn(async () => content), write: vi.fn(async () => undefined) },
  };
}

describe('E2BSandboxClient file reads', () => {
  it('keeps a leading byte-order mark of a binary response, as Buffer decoding did', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('héllo')]);
    const client = new E2BSandboxClient({ sandbox: adapterReading(bytes) });

    const text = await client.readFile('/workspace/bom.txt');

    expect(text).toBe('﻿héllo');
    expect(text).toBe(Buffer.from(bytes).toString('utf8'));
  });

  it('decodes a binary response without a mark, and passes a text response through', async () => {
    const bytes = new TextEncoder().encode('plain ✓');

    await expect(
      new E2BSandboxClient({ sandbox: adapterReading(bytes) }).readFile('/workspace/a.txt'),
    ).resolves.toBe('plain ✓');
    await expect(
      new E2BSandboxClient({ sandbox: adapterReading('﻿text') }).readFile('/workspace/b.txt'),
    ).resolves.toBe('﻿text');
  });

  it('replaces bytes that are not UTF-8 as Buffer decoding did', async () => {
    const bytes = new Uint8Array([0x61, 0xff, 0xc3, 0x28, 0x62]);

    await expect(
      new E2BSandboxClient({ sandbox: adapterReading(bytes) }).readFile('/workspace/c.txt'),
    ).resolves.toBe(Buffer.from(bytes).toString('utf8'));
  });
});
