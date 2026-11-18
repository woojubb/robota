import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCaseActionScope } from '../connectors/case-action-scope.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'personal-case-scope-'));
  directories.push(path);
  return path;
}

describe('the owner’s case action scope', () => {
  it('starts empty, preserves simultaneous choices, and persists only for that connector', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    expect(await scope.tools('connector-mail')).toEqual([]);
    await Promise.all([
      scope.set('connector-mail', 'send', true),
      scope.set('connector-mail', 'draft', true),
    ]);
    const restarted = createCaseActionScope(root);
    expect([...(await restarted.tools('connector-mail'))].sort()).toEqual(['draft', 'send']);
    expect(await restarted.tools('connector-other')).toEqual([]);
    expect(statSync(join(root, 'connector-mail.json')).mode & 0o077).toBe(0);
    await restarted.set('connector-mail', 'send', false);
    expect(await restarted.tools('connector-mail')).toEqual(['draft']);
    await restarted.clear('connector-mail');
    expect(await restarted.tools('connector-mail')).toEqual([]);
  });

  it('fails closed on malformed scope and unsafe identifiers', async () => {
    const root = directory();
    writeFileSync(join(root, 'connector-mail.json'), '{"tools":["send",7]}');
    const scope = createCaseActionScope(root);
    await expect(scope.tools('connector-mail')).rejects.toThrow();
    await expect(scope.set('connector-mail', 'send', true)).rejects.toThrow();
    await expect(scope.tools('../outside')).rejects.toThrow();
    await expect(scope.set('connector-other', '', true)).rejects.toThrow();
    await expect(scope.set('connector-other', 'x'.repeat(129), true)).rejects.toThrow();
  });
});
