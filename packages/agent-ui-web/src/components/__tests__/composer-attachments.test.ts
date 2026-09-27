import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_COUNT_LIMIT_NOTICE,
  ATTACHMENT_NO_PATH_NOTICE,
  ATTACHMENT_NON_TEXT_NOTICE,
  MAX_ATTACHMENT_COUNT,
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

  // Cheap hardening: a raw prefix check alone would treat this as "inside" (the text literally
  // starts with the root string) even though it actually names a file above the workspace once the
  // `..` is followed — canonicalizing first closes that gap.
  it('rejects a target whose raw text starts with the root but escapes it via ..', () => {
    expect(relativeWorkspacePath('/repo/sub', '/repo/sub/../../outside/x.ts')).toBeNull();
  });

  it('resolves a target carrying harmless ./ and ../ noise to its canonical relative path', () => {
    expect(relativeWorkspacePath('/repo', '/repo/./src/a.ts')).toBe('src/a.ts');
    expect(relativeWorkspacePath('/repo', '/repo/src/sub/../a.ts')).toBe('src/a.ts');
  });

  it('canonicalizes the root itself the same way before comparing', () => {
    expect(relativeWorkspacePath('/repo/sub/..', '/repo/a.ts')).toBe('a.ts');
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

  // Correction: ANY non-text MIME type the browser reports refuses the file — not just an
  // allowlisted set of "known binary" ones — so an exotic type never mangled content sneaks past.
  it('flags any MIME type the browser reports that is not text/JSON/XML, not only a known-binary allowlist', () => {
    expect(looksBinary('mystery.xyz', 'application/x-something-unheard-of')).toBe(true);
  });
});

describe('evaluateCandidateFile', () => {
  const workspacePath = '/repo';

  it('attaches a workspace file as a chip with its relative path', () => {
    const outcome = evaluateCandidateFile(
      { name: 'a.ts', size: 100, absolutePath: '/repo/src/a.ts' },
      workspacePath,
      0,
      0,
    );
    expect(outcome.kind).toBe('attached');
    if (outcome.kind === 'attached') {
      expect(outcome.attachment.relativePath).toBe('src/a.ts');
      expect(outcome.attachment.name).toBe('a.ts');
      expect(outcome.attachment.size).toBe(100);
    }
  });

  it('rejects a file with no real path (a plain browser pick or drop) with the plain sentence', () => {
    const outcome = evaluateCandidateFile({ name: 'a.ts', size: 100 }, workspacePath, 0, 0);
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file outside the workspace with the same plain sentence', () => {
    const outcome = evaluateCandidateFile(
      { name: 'passwd', size: 10, absolutePath: '/etc/passwd' },
      workspacePath,
      0,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file with no workspace path known yet, the same way', () => {
    const outcome = evaluateCandidateFile(
      { name: 'a.ts', size: 10, absolutePath: '/repo/a.ts' },
      undefined,
      0,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NO_PATH_NOTICE });
  });

  it('rejects a file over the per-file limit, naming the file', () => {
    const outcome = evaluateCandidateFile(
      { name: 'big.log', size: MAX_ATTACHMENT_FILE_BYTES + 1, absolutePath: '/repo/big.log' },
      workspacePath,
      0,
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
      workspacePath,
      0,
      0,
    );
    expect(outcome.kind).toBe('attached');
  });

  it('rejects a file that would push the running total over the combined limit', () => {
    const outcome = evaluateCandidateFile(
      { name: 'c.ts', size: 10, absolutePath: '/repo/c.ts' },
      workspacePath,
      MAX_ATTACHMENT_TOTAL_BYTES - 5,
      0,
    );
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') expect(outcome.message).toContain('256 KB');
  });

  // Correction: binary files (images included) are refused outright, never attached with a caution
  // note — the runtime's own @-reference resolver now refuses a binary file the same way.
  it('refuses an image outright, with the plain non-text sentence — not attached', () => {
    const outcome = evaluateCandidateFile(
      { name: 'shot.png', size: 100, mimeType: 'image/png', absolutePath: '/repo/shot.png' },
      workspacePath,
      0,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NON_TEXT_NOTICE });
  });

  it('refuses a known-binary extension the same way when no MIME type is known (a desktop pick)', () => {
    const outcome = evaluateCandidateFile(
      { name: 'archive.zip', size: 100, absolutePath: '/repo/archive.zip' },
      workspacePath,
      0,
      0,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_NON_TEXT_NOTICE });
  });

  it('rejects a workspace file whose name has a space, naming the syntax limit rather than failing silently', () => {
    const outcome = evaluateCandidateFile(
      { name: 'my file.txt', size: 10, absolutePath: '/repo/my file.txt' },
      workspacePath,
      0,
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
      const outcome = evaluateCandidateFile(
        { name, size: 10, absolutePath: `/repo/${name}` },
        workspacePath,
        0,
        0,
      );
      expect(outcome.kind).toBe('rejected');
    },
  );

  it('does not reject an ordinary file with a "." in the middle (an extension)', () => {
    const outcome = evaluateCandidateFile(
      { name: 'notes.txt', size: 10, absolutePath: '/repo/notes.txt' },
      workspacePath,
      0,
      0,
    );
    expect(outcome.kind).toBe('attached');
  });

  // Follow-up: a dotless filename (Makefile, Dockerfile, LICENSE, …) is common and useful and must
  // not be refused just for lacking an extension — buildPromptWithAttachments's ./ prefix (below) is
  // what makes the runtime parser recognize it, not anything evaluateCandidateFile itself withholds.
  it.each(['Makefile', 'LICENSE', 'Dockerfile'])('accepts a dotless filename (%s)', (name) => {
    const outcome = evaluateCandidateFile(
      { name, size: 10, absolutePath: `/repo/${name}` },
      workspacePath,
      0,
      0,
    );
    expect(outcome.kind).toBe('attached');
    if (outcome.kind === 'attached') expect(outcome.attachment.relativePath).toBe(name);
  });

  // Cheap hardening: mirrors the runtime's own reference-count limit (DEFAULT_MAX_REFERENCES = 8 in
  // prompt-file-reference-resolver.ts) so a 9th file is refused up front rather than only when sent.
  it('accepts up to the count limit', () => {
    const outcome = evaluateCandidateFile(
      { name: 'a.ts', size: 10, absolutePath: '/repo/a.ts' },
      workspacePath,
      0,
      MAX_ATTACHMENT_COUNT - 1,
    );
    expect(outcome.kind).toBe('attached');
  });

  it('rejects a file once the count limit is already reached, with a plain message', () => {
    const outcome = evaluateCandidateFile(
      { name: 'a.ts', size: 10, absolutePath: '/repo/a.ts' },
      workspacePath,
      0,
      MAX_ATTACHMENT_COUNT,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_COUNT_LIMIT_NOTICE });
  });

  it('checks the count limit before the path, so a well-known reason is given even for an otherwise-invalid file', () => {
    const outcome = evaluateCandidateFile(
      { name: 'photo.png', size: 10, mimeType: 'image/png', absolutePath: '/etc/photo.png' },
      workspacePath,
      0,
      MAX_ATTACHMENT_COUNT,
    );
    expect(outcome).toEqual({ kind: 'rejected', message: ATTACHMENT_COUNT_LIMIT_NOTICE });
  });
});

describe('buildPromptWithAttachments', () => {
  it('returns the prompt unchanged with no attachments', () => {
    expect(buildPromptWithAttachments('hello', [])).toBe('hello');
  });

  // Follow-up: always ./-prefixed, so a dotless name (Makefile, LICENSE, …) is still recognized as a
  // file reference by the runtime parser's isPathLikeReference, which otherwise requires a `.`
  // somewhere or an explicit relative-path prefix.
  it('appends each attachment as an @./-reference', () => {
    const result = buildPromptWithAttachments('look at this', [
      { id: '1', name: 'a.ts', relativePath: 'src/a.ts', size: 1 },
      { id: '2', name: 'b.ts', relativePath: 'src/b.ts', size: 1 },
    ]);
    expect(result).toBe('look at this\n\n@./src/a.ts @./src/b.ts');
  });

  it('carries just the references when the prompt text is empty', () => {
    const result = buildPromptWithAttachments('', [
      { id: '1', name: 'a.ts', relativePath: 'src/a.ts', size: 1 },
    ]);
    expect(result).toBe('@./src/a.ts');
  });
});
