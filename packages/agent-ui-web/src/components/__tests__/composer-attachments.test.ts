import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_NO_PATH_NOTICE,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  buildPromptWithAttachments,
  evaluateCandidateFile,
  looksBinary,
  relativeWorkspacePath,
} from '../composer-attachments.js';

/**
 * #3282 §4d: pure logic behind the composer's attach button and drag-and-drop. These limits mirror
 * `DEFAULT_MAX_FILE_BYTES`/`DEFAULT_MAX_TOTAL_BYTES` in
 * `packages/agent-framework/src/context/prompt-file-reference-resolver.ts` — a file this module would
 * attach must be one the runtime's `@`-reference resolver would actually accept.
 */

describe('relativeWorkspacePath', () => {
  it('resolves a path inside the workspace to its relative form', () => {
    expect(relativeWorkspacePath('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('rejects a path outside the workspace', () => {
    expect(relativeWorkspacePath('/repo', '/etc/passwd')).toBeNull();
  });

  it('rejects a path that only shares a prefix, not a real ancestor directory', () => {
    expect(relativeWorkspacePath('/repo', '/repo-other/a.ts')).toBeNull();
  });

  it('rejects the workspace root itself (a directory, not a file)', () => {
    expect(relativeWorkspacePath('/repo', '/repo')).toBeNull();
  });

  it('rejects when there is no workspace root to compare against', () => {
    expect(relativeWorkspacePath(undefined, '/repo/a.ts')).toBeNull();
    expect(relativeWorkspacePath('', '/repo/a.ts')).toBeNull();
  });

  it('normalizes a trailing slash on the root and backslashes in either path', () => {
    expect(relativeWorkspacePath('/repo/', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeWorkspacePath('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts');
  });
});

describe('looksBinary', () => {
  it('flags common binary/image extensions', () => {
    expect(looksBinary('photo.png', undefined)).toBe(true);
    expect(looksBinary('archive.zip', undefined)).toBe(true);
  });

  it('does not flag ordinary source/text files', () => {
    expect(looksBinary('index.ts', undefined)).toBe(false);
    expect(looksBinary('README.md', undefined)).toBe(false);
    expect(looksBinary('noext', undefined)).toBe(false);
  });

  it('trusts an image/* MIME type over a misleading extension', () => {
    expect(looksBinary('photo.dat', 'image/png')).toBe(true);
  });

  it('trusts a text/* MIME type over a misleading extension', () => {
    expect(looksBinary('data.bin', 'text/plain')).toBe(false);
  });
});

describe('evaluateCandidateFile', () => {
  const cwd = '/repo';

  it('attaches a workspace file as a chip with its relative path', () => {
    const outcome = evaluateCandidateFile({ name: 'a.ts', size: 100, absolutePath: '/repo/src/a.ts' }, cwd, 0);
    expect(outcome.kind).toBe('attached');
    if (outcome.kind === 'attached') {
      expect(outcome.attachment.relativePath).toBe('src/a.ts');
      expect(outcome.attachment.name).toBe('a.ts');
      expect(outcome.attachment.size).toBe(100);
      expect(outcome.attachment.looksBinary).toBe(false);
    }
  });

  it('rejects a file with no real path (a plain browser pick or drop) with the plain sentence', () => {
    const outcome = evaluateCandidateFile({ name: 'a.ts', size: 100 }, cwd, 0);
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file outside the workspace with the same plain sentence', () => {
    const outcome = evaluateCandidateFile(
      { name: 'passwd', size: 10, absolutePath: '/etc/passwd' },
      cwd,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file with no cwd known yet, the same way', () => {
    const outcome = evaluateCandidateFile(
      { name: 'a.ts', size: 10, absolutePath: '/repo/a.ts' },
      undefined,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file over the per-file limit, naming the file', () => {
    const outcome = evaluateCandidateFile(
      { name: 'big.log', size: MAX_ATTACHMENT_FILE_BYTES + 1, absolutePath: '/repo/big.log' },
      cwd,
      0,
    );
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.message).toContain('big.log');
      expect(outcome.message).toContain('64 KB');
    }
  });

  it('accepts a file exactly at the per-file limit', () => {
    const outcome = evaluateCandidateFile(
      { name: 'exact.log', size: MAX_ATTACHMENT_FILE_BYTES, absolutePath: '/repo/exact.log' },
      cwd,
      0,
    );
    expect(outcome.kind).toBe('attached');
  });

  it('rejects a file that would push the running total over the combined limit', () => {
    const outcome = evaluateCandidateFile(
      { name: 'c.ts', size: 10, absolutePath: '/repo/c.ts' },
      cwd,
      MAX_ATTACHMENT_TOTAL_BYTES - 5,
    );
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') expect(outcome.message).toContain('256 KB');
  });

  it('flags an image as looksBinary while still attaching it (images fall back to @-references, #3282 §4)', () => {
    const outcome = evaluateCandidateFile(
      { name: 'shot.png', size: 100, mimeType: 'image/png', absolutePath: '/repo/shot.png' },
      cwd,
      0,
    );
    expect(outcome.kind).toBe('attached');
    if (outcome.kind === 'attached') expect(outcome.attachment.looksBinary).toBe(true);
  });

  it('rejects a workspace file whose name has a space, naming the syntax limit rather than failing silently', () => {
    const outcome = evaluateCandidateFile(
      { name: 'my file.txt', size: 10, absolutePath: '/repo/my file.txt' },
      cwd,
      0,
    );
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') expect(outcome.message).toContain('my file.txt');
  });

  // The runtime's @-reference parser strips a trailing .,:;!? off every captured token
  // (`stripTrailingPunctuation` in prompt-file-reference-parser.ts) before resolving it — a chip for
  // a file whose name ends in one of those would otherwise promise a reference the runtime silently
  // truncates and then can't find.
  it.each(['notes.', 'todo:', 'important!', 'maybe?'])(
    'rejects a workspace file whose name ends in trailing punctuation the parser would strip (%s)',
    (name) => {
      const outcome = evaluateCandidateFile({ name, size: 10, absolutePath: `/repo/${name}` }, cwd, 0);
      expect(outcome.kind).toBe('rejected');
    },
  );

  it('does not reject an ordinary file with a "." in the middle (an extension)', () => {
    const outcome = evaluateCandidateFile(
      { name: 'notes.txt', size: 10, absolutePath: '/repo/notes.txt' },
      cwd,
      0,
    );
    expect(outcome.kind).toBe('attached');
  });
});

describe('buildPromptWithAttachments', () => {
  it('returns the prompt unchanged with no attachments', () => {
    expect(buildPromptWithAttachments('hello', [])).toBe('hello');
  });

  it('appends each attachment as an @-reference', () => {
    const result = buildPromptWithAttachments('look at this', [
      { id: '1', name: 'a.ts', relativePath: 'src/a.ts', size: 1, looksBinary: false },
      { id: '2', name: 'b.ts', relativePath: 'src/b.ts', size: 1, looksBinary: false },
    ]);
    expect(result).toBe('look at this\n\n@src/a.ts @src/b.ts');
  });

  it('carries just the references when the prompt text is empty', () => {
    const result = buildPromptWithAttachments('', [
      { id: '1', name: 'a.ts', relativePath: 'src/a.ts', size: 1, looksBinary: false },
    ]);
    expect(result).toBe('@src/a.ts');
  });
});
