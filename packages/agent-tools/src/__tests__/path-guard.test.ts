import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPathWithinCwd } from '../builtins/path-guard.js';

describe('checkPathWithinCwd', () => {
  const cwd = '/project/root';

  // ARCH-010 inverted this. It used to assert `undefined` — "no objection" — which is what let a
  // rootless `Read` return `/etc/hostname`. A guard with no configured boundary now refuses.
  it('REFUSES when cwd is not set', () => {
    const error = checkPathWithinCwd('/etc/passwd', undefined);
    expect(error).toBeDefined();
    expect(error).toMatch(/no containment root/i);
  });

  it('returns undefined for path inside cwd', () => {
    expect(checkPathWithinCwd('/project/root/src/index.ts', cwd)).toBeUndefined();
  });

  it('returns undefined for deeply nested path inside cwd', () => {
    expect(checkPathWithinCwd('/project/root/a/b/c/d.ts', cwd)).toBeUndefined();
  });

  it('returns error JSON for path outside cwd', () => {
    const result = checkPathWithinCwd('/etc/passwd', cwd);
    expect(result).not.toBeUndefined();
    const parsed = JSON.parse(result!);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/outside the working directory/);
  });

  it('returns error JSON for path with traversal', () => {
    const result = checkPathWithinCwd('/project/other/file.ts', cwd);
    expect(result).not.toBeUndefined();
    const parsed = JSON.parse(result!);
    expect(parsed.success).toBe(false);
  });

  it('returns error JSON for home directory path', () => {
    const homeFile = join(tmpdir(), 'secret.txt');
    const result = checkPathWithinCwd(homeFile, cwd);
    expect(result).not.toBeUndefined();
  });

  it('returns undefined for cwd itself', () => {
    expect(checkPathWithinCwd('/project/root', cwd)).toBeUndefined();
  });

  it('blocks path that is a prefix match but not a child (path traversal via prefix)', () => {
    const result = checkPathWithinCwd('/project/root-other/file.ts', cwd);
    expect(result).not.toBeUndefined();
    const parsed = JSON.parse(result!);
    expect(parsed.success).toBe(false);
  });
});

/**
 * SEC-006 — the guard is the ONLY sandbox boundary for `Read`/`Write`/`Edit` when no provider sandbox
 * is injected (see `pack-coding`'s `ICodingPackOptions.cwd`). It compared `path.resolve()` output,
 * which performs pure lexical normalization and does NOT resolve symlinks — so a symlink *inside* the
 * working directory pointing outside it satisfied `startsWith(cwd + sep)` while `readFile`/`writeFile`
 * followed the link to the real target. A symlink is ordinary committed git content, so merely cloning
 * an untrusted repository and pointing the agent at it was enough to arm this.
 *
 * These tests use the REAL filesystem: the previous suite only ever passed fictional path strings, which
 * is precisely why the hole survived — a lexical-only test can never observe a symlink.
 */
describe('checkPathWithinCwd — symlink containment (SEC-006)', () => {
  let root: string;
  let workdir: string;
  let outside: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'path-guard-')));
    workdir = join(root, 'workdir');
    outside = join(root, 'outside');
    mkdirSync(workdir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'top-secret');
    // an ordinary committed-symlink shape: a link inside the workdir escaping to a sibling tree
    symlinkSync(outside, join(workdir, 'escape'));
    symlinkSync(join(outside, 'secret.txt'), join(workdir, 'secret-link.txt'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('blocks reading through a symlinked DIRECTORY that escapes cwd', () => {
    const result = checkPathWithinCwd(join(workdir, 'escape', 'secret.txt'), workdir);
    expect(result).not.toBeUndefined();
    expect(JSON.parse(result!).success).toBe(false);
  });

  it('blocks a symlinked FILE whose target is outside cwd', () => {
    const result = checkPathWithinCwd(join(workdir, 'secret-link.txt'), workdir);
    expect(result).not.toBeUndefined();
    expect(JSON.parse(result!).success).toBe(false);
  });

  it('blocks WRITING a new file through an escaping symlinked directory', () => {
    // write/edit tools pass paths that do not exist yet — the guard must still canonicalize the parent
    const result = checkPathWithinCwd(join(workdir, 'escape', 'planted.sh'), workdir);
    expect(result).not.toBeUndefined();
    expect(JSON.parse(result!).success).toBe(false);
  });

  it('still ALLOWS a real file inside cwd', () => {
    writeFileSync(join(workdir, 'ok.txt'), 'fine');
    expect(checkPathWithinCwd(join(workdir, 'ok.txt'), workdir)).toBeUndefined();
  });

  it('still ALLOWS a not-yet-created file inside cwd (write/edit path)', () => {
    expect(checkPathWithinCwd(join(workdir, 'nested', 'new.txt'), workdir)).toBeUndefined();
  });

  it('still ALLOWS cwd itself when cwd is reached through a symlink (e.g. /tmp on macOS)', () => {
    // `mkdtemp(tmpdir())` is itself behind a symlink on macOS (/tmp -> /private/tmp); canonicalizing
    // both sides must not turn that into a spurious denial.
    expect(checkPathWithinCwd(workdir, workdir)).toBeUndefined();
  });
});
