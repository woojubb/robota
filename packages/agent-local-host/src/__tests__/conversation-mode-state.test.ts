import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readProductConversationMode,
  writeProductConversationMode,
} from '../conversation-mode-state.js';

const homes: string[] = [];
function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'conversation-mode-state-'));
  homes.push(path);
  return path;
}

afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('the conversation mode choice', () => {
  it('commits transitions as private files and refuses a stale expected mode', () => {
    const root = join(home(), 'state');
    expect(readProductConversationMode(root)).toBe('plain');
    writeProductConversationMode(root, 'plain', 'preparing');
    expect(readProductConversationMode(root)).toBe('preparing');
    expect(() => writeProductConversationMode(root, 'plain', 'secure')).toThrow(/changed/i);
    writeProductConversationMode(root, 'preparing', 'secure');
    expect(readProductConversationMode(root)).toBe('secure');
    writeProductConversationMode(root, 'secure', 'plain');
    expect(readProductConversationMode(root)).toBe('plain');
    if (process.platform !== 'win32') {
      expect(lstatSync(join(root, 'secure')).mode & 0o077).toBe(0);
      expect(lstatSync(join(root, 'secure', 'mode.json')).mode & 0o077).toBe(0);
    }
  });

  it('refuses a linked or malformed mode choice', () => {
    const root = join(home(), 'state');
    mkdirSync(join(root, 'secure'), { recursive: true, mode: 0o700 });
    const target = join(root, 'target');
    writeFileSync(target, '{"schemaVersion":1,"mode":"on"}', { mode: 0o600 });
    symlinkSync(target, join(root, 'secure', 'mode.json'));
    expect(() => readProductConversationMode(root)).toThrow(/ordinary private file/i);
    rmSync(join(root, 'secure', 'mode.json'));
    writeFileSync(join(root, 'secure', 'mode.json'), '{"schemaVersion":1,"mode":"unexpected"}', {
      mode: 0o600,
    });
    expect(() => readProductConversationMode(root)).toThrow(/invalid/i);
  });
});
