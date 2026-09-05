import { existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createQuery } from '../../query.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createQuery canonical permission adapter (ARCH-017)', () => {
  it('subscribes to permission_request and settles an allowed tool through the registry', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'arch-017-query-')));
    roots.push(cwd);
    const markerPath = join(cwd, 'allowed.txt');
    const script = createScriptedProvider([
      {
        toolCalls: [
          {
            name: 'Bash',
            args: { command: `printf allowed > ${JSON.stringify(markerPath)}` },
          },
        ],
      },
      { text: 'done' },
    ]);
    const permissionHandler = vi.fn().mockResolvedValue(true);
    const query = createQuery({
      cwd,
      provider: script.provider,
      permissionMode: 'default',
      permissionHandler,
    });

    await expect(query('run the gated tool')).resolves.toBe('done');

    expect(permissionHandler).toHaveBeenCalledTimes(1);
    expect(permissionHandler).toHaveBeenCalledWith('Bash', expect.any(Object));
    expect(existsSync(markerPath)).toBe(true);
  });

  it('fails closed when the permission callback rejects', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'arch-017-query-')));
    roots.push(cwd);
    const markerPath = join(cwd, 'denied.txt');
    const script = createScriptedProvider([
      {
        toolCalls: [
          {
            name: 'Bash',
            args: { command: `printf denied > ${JSON.stringify(markerPath)}` },
          },
        ],
      },
      { text: 'continued' },
    ]);
    const query = createQuery({
      cwd,
      provider: script.provider,
      permissionMode: 'default',
      permissionHandler: () => Promise.reject(new Error('surface failed')),
    });

    await expect(query('attempt the gated tool')).resolves.toBe('continued');
    expect(existsSync(markerPath)).toBe(false);
  });
});
