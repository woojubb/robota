import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createAgentPresence } from '../agent-presence.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it('recovers only when no other agent may still own a prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-presence-'));
  directories.push(root);
  const first = createAgentPresence(root);
  const second = createAgentPresence(root);
  const third = createAgentPresence(root);
  const recover = vi.fn(async () => undefined);
  try {
    await first.enter(recover);
    await second.enter(recover);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(first.others()).toBe(true);
    expect(second.others()).toBe(true);
    first.close();
    expect(second.others()).toBe(false);
    second.close();
    await third.enter(recover);
    expect(recover).toHaveBeenCalledTimes(2);
  } finally {
    first.close();
    second.close();
    third.close();
  }
});
