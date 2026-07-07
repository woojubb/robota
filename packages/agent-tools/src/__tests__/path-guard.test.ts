import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPathWithinCwd } from '../builtins/path-guard.js';

describe('checkPathWithinCwd', () => {
  const cwd = '/project/root';

  it('returns undefined when cwd is not set', () => {
    expect(checkPathWithinCwd('/etc/passwd', undefined)).toBeUndefined();
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

  it('blocks symlinked files that resolve outside cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-path-guard-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'robota-path-guard-outside-'));

    try {
      const secretPath = join(outside, 'secret.txt');
      const linkPath = join(root, 'secret-link.txt');
      writeFileSync(secretPath, 'secret\n', 'utf8');
      symlinkSync(secretPath, linkPath);

      const result = checkPathWithinCwd(linkPath, root);
      expect(result).not.toBeUndefined();
      const parsed = JSON.parse(result!);
      expect(parsed.success).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('blocks paths below symlinked directories that resolve outside cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-path-guard-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'robota-path-guard-outside-'));

    try {
      const outsideDir = join(outside, 'target');
      const linkDir = join(root, 'linked-dir');
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, linkDir, 'dir');

      const result = checkPathWithinCwd(join(linkDir, 'generated.txt'), root);
      expect(result).not.toBeUndefined();
      const parsed = JSON.parse(result!);
      expect(parsed.success).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
