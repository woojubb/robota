/**
 * Replacing a file other processes append to, by rename. A platform that lets an open file be
 * replaced renames first and catches up from the old descriptor afterwards; Windows does not, so
 * there the catch-up runs first, the old descriptor is released and the rename is retried while
 * another handle holds the file. The release-first cases pass the platform in, so they run on every
 * host; the cases about a handle that really blocks a rename run where the platform does that.
 */
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { rewriteAppendFile } from '../append-file-rewrite.js';

import type { IAppendFileRewriter } from '../append-file-rewrite.js';

const rename = vi.hoisted(() => ({ failures: [] as string[] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      const code = rename.failures.shift();
      if (code !== undefined) throw Object.assign(new Error(`${code}: rename`), { code });
      return actual.renameSync(...args);
    },
  };
});

const NO_PAUSE = async (): Promise<void> => {};
const roots: string[] = [];

afterEach(() => {
  rename.failures.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-append-rewrite-')));
  roots.push(root);
  return root;
}

/** Upper-cases every non-empty line, framing a caught-up line the way the real rewriters do. */
const upperCase: IAppendFileRewriter = {
  rewrite(lines, out, leadingNewline) {
    for (const line of lines) {
      if (line.length > 0) out.write(`${leadingNewline ? '\n' : ''}${line.toUpperCase()}\n`);
    }
  },
};

/** Lines, without the empty ones a caught-up line's framing leaves. */
function linesOf(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

describe.each(['linux', 'win32'])('rewriteAppendFile replacing as %s', (platform) => {
  it('rewrites every line into a new file that replaces the old, leaving no temporary file', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\ntwo\n');

    const result = await rewriteAppendFile(path, upperCase, { platform, pause: NO_PAUSE });

    expect(result).toMatchObject({ status: 'rewritten', droppedTail: false });
    expect(linesOf(path)).toEqual(['ONE', 'TWO']);
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('carries over a line appended by path after the snapshot and before the commit', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');

    const result = await rewriteAppendFile(path, upperCase, {
      platform,
      pause: NO_PAUSE,
      beforeCommit: () => appendFileSync(path, 'two\n'),
    });

    expect(result.status).toBe('rewritten');
    expect(linesOf(path)).toEqual(['ONE', 'TWO']);
  });

  it('says another file took the name when one replaced it before the rename, and replaces nothing', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');

    const result = await rewriteAppendFile(path, upperCase, {
      platform,
      pause: NO_PAUSE,
      beforeCommit: () => {
        writeFileSync(join(root, 'theirs.tmp'), 'one\ntwo\n');
        rmSync(path);
        renameSync(join(root, 'theirs.tmp'), path);
      },
    });

    expect(result).toEqual({ status: 'replaced' });
    expect(readFileSync(path, 'utf8')).toBe('one\ntwo\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('says a file deleted before the rename was removed, and puts nothing back', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');

    const result = await rewriteAppendFile(path, upperCase, {
      platform,
      pause: NO_PAUSE,
      beforeCommit: () => rmSync(path),
    });

    expect(result).toEqual({ status: 'removed' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('leaves the file and no temporary file when the commit is refused', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');

    await expect(
      rewriteAppendFile(path, upperCase, {
        platform,
        pause: NO_PAUSE,
        beforeCommit: () => {
          throw new Error('another process started');
        },
      }),
    ).rejects.toThrow('another process started');

    expect(readFileSync(path, 'utf8')).toBe('one\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });
});

describe('rewriteAppendFile replacing as win32 (release first)', () => {
  it('catches up, before the rename, a line appended by path while it waits', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    let pauses = 0;

    const result = await rewriteAppendFile(path, upperCase, {
      platform: 'win32',
      pause: async () => {
        pauses += 1;
        if (pauses === 1) appendFileSync(path, 'two\n');
      },
    });

    expect(result).toMatchObject({ status: 'rewritten', droppedTail: false });
    expect(linesOf(path)).toEqual(['ONE', 'TWO']);
  });

  it('abandons the rewrite, replacing nothing, when the catch-up fails', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    let calls = 0;
    const failingLate: IAppendFileRewriter = {
      rewrite(lines, out, leadingNewline) {
        calls += 1;
        if (calls > 1) throw new Error('the rewriter failed');
        upperCase.rewrite(lines, out, leadingNewline);
      },
    };

    await expect(
      rewriteAppendFile(path, failingLate, {
        platform: 'win32',
        pause: NO_PAUSE,
        beforeCommit: () => appendFileSync(path, 'two\n'),
      }),
    ).rejects.toThrow('the rewriter failed');

    expect(readFileSync(path, 'utf8')).toBe('one\ntwo\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('retries a rename an open handle blocks, carrying over what was appended meanwhile', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    rename.failures.push('EPERM', 'EBUSY');
    let pauses = 0;

    const result = await rewriteAppendFile(path, upperCase, {
      platform: 'win32',
      pause: async () => {
        pauses += 1;
        // The third pause is the first wait after the first blocked rename.
        if (pauses === 3) appendFileSync(path, 'two\n');
      },
    });

    expect(result.status).toBe('rewritten');
    expect(linesOf(path)).toEqual(['ONE', 'TWO']);
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('raises the failure, replacing nothing, when the file stays held for every attempt', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    rename.failures.push(...Array.from({ length: 10 }, () => 'EPERM'));

    await expect(
      rewriteAppendFile(path, upperCase, { platform: 'win32', pause: NO_PAUSE }),
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(readFileSync(path, 'utf8')).toBe('one\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('raises at once a rename failure that is not about the file being held', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    rename.failures.push('ENOSPC', 'EPERM');

    await expect(
      rewriteAppendFile(path, upperCase, { platform: 'win32', pause: NO_PAUSE }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });

    expect(rename.failures).toEqual(['EPERM']);
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('says the file was replaced when another file has taken the name by the retry', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    rename.failures.push('EPERM');
    let pauses = 0;

    const result = await rewriteAppendFile(path, upperCase, {
      platform: 'win32',
      pause: async () => {
        pauses += 1;
        if (pauses !== 3) return;
        writeFileSync(join(root, 'theirs.tmp'), 'theirs\n');
        rmSync(path);
        renameSync(join(root, 'theirs.tmp'), path);
      },
    });

    expect(result).toEqual({ status: 'replaced' });
    expect(readFileSync(path, 'utf8')).toBe('theirs\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });
});

describe.runIf(process.platform === 'win32')('a handle that really blocks the rename', () => {
  it('lets the rename through once the writer closes, carrying over what it appended', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    const writer = openSync(path, 'a');
    let pauses = 0;
    try {
      const result = await rewriteAppendFile(path, upperCase, {
        pause: async () => {
          pauses += 1;
          if (pauses === 3) {
            writeSync(writer, 'two\n');
            closeSync(writer);
          }
        },
      });

      expect(result.status).toBe('rewritten');
    } finally {
      try {
        closeSync(writer);
      } catch {
        // allow-fallback: the writer was already closed by the pause that released it.
      }
    }
    expect(linesOf(path)).toEqual(['ONE', 'TWO']);
  });

  it('raises, replacing nothing, while a writer holds the file open', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');
    const writer = openSync(path, 'a');
    try {
      await expect(rewriteAppendFile(path, upperCase, { pause: NO_PAUSE })).rejects.toMatchObject({
        code: expect.stringMatching(/^(EPERM|EBUSY|EACCES)$/u),
      });
      writeSync(writer, 'two\n');
    } finally {
      closeSync(writer);
    }
    expect(readFileSync(path, 'utf8')).toBe('one\ntwo\n');
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });
});
