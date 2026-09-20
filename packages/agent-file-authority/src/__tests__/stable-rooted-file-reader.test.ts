import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createStableRootedFileReaderForTest,
  type IFileAuthorityTestHooks,
} from '../stable-rooted-file-reader.js';
import {
  createStableRootedFileReader,
  StableFileAuthorityError,
  type TStableFileAuthorityErrorCode,
} from '../index.js';

const temporaryDirectories: string[] = [];
const readers: Array<{ close(): void }> = [];

afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function track<T extends { close(): void }>(reader: T): T {
  readers.push(reader);
  return reader;
}

function fixture(): { root: string; outside: string; cleanupRoot: string } {
  const cleanupRoot = mkdtempSync(join(tmpdir(), 'robota-file-authority-'));
  temporaryDirectories.push(cleanupRoot);
  const root = join(cleanupRoot, 'root');
  const outside = join(cleanupRoot, 'outside');
  mkdirSync(join(root, 'nested'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { root, outside, cleanupRoot };
}

function expectCode(operation: () => unknown, code: TStableFileAuthorityErrorCode): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(StableFileAuthorityError);
    expect((error as StableFileAuthorityError).code).toBe(code);
    return;
  }
  throw new Error(`Expected StableFileAuthorityError ${code}.`);
}

describe('stable rooted file reader', () => {
  it('reads one nested regular file and represents only missing as undefined', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'nested', 'payload.bin'), 'approved');
    const reader = track(createStableRootedFileReader(root));

    expect(Buffer.from(reader.readBytes(['nested', 'payload.bin'], 8) ?? []).toString()).toBe(
      'approved',
    );
    expect(reader.readBytes(['nested', 'missing.bin'], 8)).toBeUndefined();
  });

  it('validates every segment and byte budget before host I/O', () => {
    const { root } = fixture();
    const reader = track(createStableRootedFileReader(root));

    for (const segments of [[], [''], ['.'], ['..'], ['a/b'], ['a\\b'], ['a\0b']]) {
      expectCode(() => reader.readBytes(segments, 1), 'INVALID_PATH');
    }
    for (const budget of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectCode(() => reader.readBytes(['missing'], budget), 'INVALID_PATH');
    }
  });

  it('stays attached to the opened root when its original pathname is replaced', () => {
    const { root, cleanupRoot } = fixture();
    writeFileSync(join(root, 'nested', 'payload.bin'), 'approved');
    const reader = track(createStableRootedFileReader(root));

    const moved = join(cleanupRoot, 'root-original');
    renameSync(root, moved);
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'nested', 'payload.bin'), 'retargeted');

    expect(Buffer.from(reader.readBytes(['nested', 'payload.bin'], 32) ?? []).toString()).toBe(
      'approved',
    );
  });

  it('stays attached to an opened parent when that parent pathname is replaced mid-walk', () => {
    const { root, outside } = fixture();
    const original = join(root, 'nested');
    const moved = join(root, 'nested-original');
    writeFileSync(join(original, 'payload.bin'), 'approved');
    writeFileSync(join(outside, 'payload.bin'), 'retargeted');
    const hooks: IFileAuthorityTestHooks = {
      afterDirectoryOpened: (index) => {
        if (index !== 0) return;
        renameSync(original, moved);
        symlinkSync(outside, original, process.platform === 'win32' ? 'junction' : 'dir');
      },
    };
    const reader = track(createStableRootedFileReaderForTest(root, hooks));

    expect(Buffer.from(reader.readBytes(['nested', 'payload.bin'], 32) ?? []).toString()).toBe(
      'approved',
    );
  });

  it('refuses parent and final links or reparse points', () => {
    const { root, outside } = fixture();
    writeFileSync(join(outside, 'payload.bin'), 'outside-secret');
    symlinkSync(
      outside,
      join(root, 'linked-parent'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    symlinkSync(
      join(outside, 'payload.bin'),
      join(root, 'linked-file.bin'),
      process.platform === 'win32' ? 'file' : 'file',
    );
    const reader = track(createStableRootedFileReader(root));

    expectCode(() => reader.readBytes(['linked-parent', 'payload.bin'], 64), 'UNSAFE_ENTRY');
    expectCode(() => reader.readBytes(['linked-file.bin'], 64), 'UNSAFE_ENTRY');
  });

  it('refuses non-regular final entries and enforces exact and zero-byte budgets', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'empty.bin'), '');
    writeFileSync(join(root, 'one.bin'), 'x');
    const reader = track(createStableRootedFileReader(root));

    expect(reader.readBytes(['empty.bin'], 0)?.byteLength).toBe(0);
    expect(Buffer.from(reader.readBytes(['one.bin'], 1) ?? []).toString()).toBe('x');
    expectCode(() => reader.readBytes(['one.bin'], 0), 'OVER_BUDGET');
    expectCode(() => reader.readBytes(['nested'], 32), 'UNSAFE_ENTRY');
  });

  it('detects deterministic growth during a read', () => {
    const { root } = fixture();
    const payload = join(root, 'payload.bin');
    writeFileSync(payload, 'a');
    let changed = false;
    const reader = track(
      createStableRootedFileReaderForTest(root, {
        afterReadChunk: () => {
          if (changed) return;
          changed = true;
          appendFileSync(payload, 'b');
        },
      }),
    );

    expectCode(() => reader.readBytes(['payload.bin'], 8), 'FILE_CHANGED');
  });

  it('closes idempotently and rejects every later operation', () => {
    const { root } = fixture();
    const reader = createStableRootedFileReader(root);
    reader.close();
    reader.close();
    reader[Symbol.dispose]();

    expectCode(() => reader.readBytes(['nested', 'missing.bin'], 1), 'AUTHORITY_CLOSED');
  });

  it('keeps diagnostics free of absolute roots and file bytes', () => {
    const { root } = fixture();
    const secret = 'outside-secret-value';
    writeFileSync(join(root, 'payload.bin'), secret);
    const reader = track(createStableRootedFileReader(root));

    try {
      reader.readBytes(['payload.bin'], 0);
    } catch (error) {
      const rendered = JSON.stringify(error);
      expect(rendered).not.toContain(root);
      expect(rendered).not.toContain(secret);
      expect(String(error)).not.toContain(root);
      expect(String(error)).not.toContain(secret);
      return;
    }
    throw new Error('Expected an over-budget error.');
  });
});
