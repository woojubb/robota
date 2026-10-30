import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StableFileAuthorityError } from '../contracts.js';
import {
  createStableRootedFileWriter,
  createStableRootedFileWriterForTest,
} from '../stable-rooted-file-writer.js';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('stable rooted file writer', () => {
  it('creates missing parents and atomically replaces an existing file', () => {
    const root = temporaryRoot('stable-writer-');
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'target.txt'), 'before', { mode: 0o755 });
    chmodSync(join(root, 'nested', 'target.txt'), 0o755);

    const writer = createStableRootedFileWriter(root);
    try {
      writer.writeUtf8(['nested', 'target.txt'], 'after');
      writer.writeUtf8(['created', 'deeper', 'file.txt'], 'new');
    } finally {
      writer.close();
    }

    expect(readFileSync(join(root, 'nested', 'target.txt'), 'utf8')).toBe('after');
    if (process.platform !== 'win32') {
      expect(statSync(join(root, 'nested', 'target.txt')).mode & 0o777).toBe(0o755);
    }
    expect(readFileSync(join(root, 'created', 'deeper', 'file.txt'), 'utf8')).toBe('new');
    expect(
      readdirSync(join(root, 'nested')).filter((name) => name.includes('.atomic-tmp-')),
    ).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    'refuses a root replacement during a named-root write before committing',
    () => {
      const base = temporaryRoot('stable-writer-named-root-swap-');
      const root = join(base, 'root');
      const moved = join(base, 'moved');
      mkdirSync(root);
      writeFileSync(join(root, 'note.txt'), 'original');
      const writer = createStableRootedFileWriterForTest(root, {
        afterPreCommitValidated: () => {
          renameSync(root, moved);
          mkdirSync(root);
        },
      });
      try {
        expect(() => writer.writeUtf8WhileNamed(['note.txt'], 'replacement')).toThrow();
      } finally {
        writer.close();
      }
      expect(readFileSync(join(moved, 'note.txt'), 'utf8')).toBe('original');
      expect(readdirSync(root)).toEqual([]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'refuses a target created after the initial absence check',
    () => {
      const root = temporaryRoot('stable-writer-target-create-');
      const target = join(root, 'target.txt');

      const writer = createStableRootedFileWriterForTest(root, {
        afterTemporaryWritten: () => {
          writeFileSync(target, 'competing');
        },
      });

      try {
        expect(() => writer.writeUtf8(['target.txt'], 'replacement')).toThrow(
          StableFileAuthorityError,
        );
      } finally {
        writer.close();
      }
      expect(readFileSync(target, 'utf8')).toBe('competing');
      expect(readdirSync(root).filter((name) => name.includes('.atomic-tmp-'))).toEqual([]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rolls back when the retained parent moves outside the root after validation',
    () => {
      const base = temporaryRoot('stable-writer-post-check-parent-swap-');
      const root = join(base, 'root');
      const parent = join(root, 'parent');
      const moved = join(base, 'moved');
      mkdirSync(parent, { recursive: true });
      writeFileSync(join(parent, 'note.txt'), 'inside');

      const writer = createStableRootedFileWriterForTest(root, {
        afterPreCommitValidated: () => renameSync(parent, moved),
      });

      try {
        expect(() => writer.writeUtf8(['parent', 'note.txt'], 'replacement')).toThrow(
          StableFileAuthorityError,
        );
      } finally {
        writer.close();
      }
      expect(readFileSync(join(moved, 'note.txt'), 'utf8')).toBe('inside');
      expect(readdirSync(moved).filter((name) => name.includes('.atomic-tmp-'))).toEqual([]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'refuses a parent link introduced before the native commit',
    () => {
      const base = temporaryRoot('stable-writer-parent-swap-');
      const root = join(base, 'root');
      const parent = join(root, 'parent');
      const moved = join(base, 'moved');
      const outside = join(base, 'outside');
      mkdirSync(parent, { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(parent, 'note.txt'), 'inside');
      writeFileSync(join(outside, 'note.txt'), 'outside');

      const writer = createStableRootedFileWriterForTest(root, {
        afterDirectoryOpened: (index) => {
          if (index !== 0) return;
          renameSync(parent, moved);
          symlinkSync(outside, parent);
        },
      });

      try {
        expect(() => writer.writeUtf8(['parent', 'note.txt'], 'replacement')).toThrow(
          StableFileAuthorityError,
        );
      } finally {
        writer.close();
      }
      expect(readFileSync(join(outside, 'note.txt'), 'utf8')).toBe('outside');
      expect(readFileSync(join(moved, 'note.txt'), 'utf8')).toBe('inside');
    },
  );

  it.runIf(process.platform !== 'win32')(
    'refuses a substituted temporary entry without installing its link as the target',
    () => {
      const root = temporaryRoot('stable-writer-temp-swap-');
      const target = join(root, 'target.txt');
      const outside = join(root, 'outside.txt');
      writeFileSync(target, 'inside');
      writeFileSync(outside, 'outside');

      const writer = createStableRootedFileWriterForTest(root, {
        afterTemporaryWritten: (temporaryName) => {
          renameSync(join(root, temporaryName), join(root, 'captured-temporary'));
          symlinkSync(outside, join(root, temporaryName));
        },
      });

      try {
        expect(() => writer.writeUtf8(['target.txt'], 'replacement')).toThrow(
          StableFileAuthorityError,
        );
      } finally {
        writer.close();
      }
      expect(readFileSync(target, 'utf8')).toBe('inside');
      expect(lstatSync(target).isSymbolicLink()).toBe(false);
      expect(readFileSync(outside, 'utf8')).toBe('outside');
    },
  );
});
