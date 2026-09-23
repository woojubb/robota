import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeExternalPayloadSource } from '../session-log-sources.js';

const replacement = vi.hoisted(() => ({
  armed: false,
  swapped: false,
  targetPath: '',
  heldPath: '',
  replacementText: '',
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const interceptedOpen = ((...args: Parameters<typeof actual.openSync>): number => {
    const descriptor = actual.openSync(...args);
    const openedPath = String(args[0]);
    if (replacement.armed && !replacement.swapped && openedPath.endsWith('/payload.json')) {
      replacement.swapped = true;
      actual.renameSync(replacement.targetPath, replacement.heldPath);
      actual.writeFileSync(replacement.targetPath, replacement.replacementText);
    }
    return descriptor;
  }) as typeof actual.openSync;
  return { ...actual, openSync: interceptedOpen };
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  replacement.armed = false;
  replacement.swapped = false;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('NodeExternalPayloadSource descriptor stability', () => {
  it.skipIf(process.platform !== 'linux')(
    'ARCH-042: reads the opened file after its pathname is replaced',
    () => {
      const baseDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'robota-payload-descriptor-')));
      temporaryDirectories.push(baseDirectory);
      replacement.targetPath = join(baseDirectory, 'payload.json');
      replacement.heldPath = join(baseDirectory, 'held.json');
      replacement.replacementText = 'replacement';
      writeFileSync(replacement.targetPath, 'descriptor-owned');
      replacement.armed = true;

      const bytes = new NodeExternalPayloadSource(baseDirectory).readBytes('payload.json', 64);

      expect(replacement.swapped).toBe(true);
      expect(Buffer.from(bytes ?? []).toString('utf8')).toBe('descriptor-owned');
    },
  );
});
