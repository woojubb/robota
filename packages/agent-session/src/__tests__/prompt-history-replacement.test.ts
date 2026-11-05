import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({ path: '', moved: '', stage: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync(path: Parameters<typeof actual.openSync>[0], flags: Parameters<typeof actual.openSync>[1], mode?: Parameters<typeof actual.openSync>[2]) {
      if (path === swap.path && typeof flags === 'number' && (flags & actual.constants.O_WRONLY) !== 0) {
        if (swap.stage === 1) {
          swap.stage = 2;
          actual.renameSync(swap.path, swap.moved);
          actual.writeFileSync(swap.path, 'replacement');
        } else if (swap.stage === 0) {
          swap.stage = 1;
        }
      }
      return actual.openSync(path, flags, mode);
    },
  };
});

const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
const { NodePromptHistoryFile } = await import('../prompt-history-file.js');
let root = '';
afterEach(() => {
  if (root !== '') fs.rmSync(root, { recursive: true, force: true });
  root = '';
  swap.path = '';
  swap.moved = '';
  swap.stage = 0;
});

it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('refuses a history replacement between repair and append', () => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'history-replacement-')));
  swap.path = join(root, 'history.jsonl');
  swap.moved = join(root, 'original.jsonl');
  fs.writeFileSync(swap.path, 'original\n');
  fs.chmodSync(swap.path, 0o400);
  const history = new NodePromptHistoryFile(swap.path, { sealing: 'plain', ownedRoot: root });
  expect(() => history.append({ at: '2026-01-01T00:00:00Z', sessionId: 's', project: '/p', text: 'new' })).toThrow(/history.*changed/i);
  expect(swap.stage).toBe(2);
  expect(fs.readFileSync(swap.path, 'utf8')).toBe('replacement');
  expect(fs.readFileSync(swap.moved, 'utf8')).toBe('original\n');
});
