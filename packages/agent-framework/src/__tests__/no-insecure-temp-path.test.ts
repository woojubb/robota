import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * SEC-003 regression floor for CodeQL `js/insecure-temporary-file` (CWE-377).
 *
 * The rule's taint source is an `os.tmpdir()` call or a `'/tmp/…'` string literal; its sink
 * is the path argument of an `fs` write that does not pass an owner-only `mode`. Taint stops
 * at `mkdtemp`/`mkdtempSync`, because the OS — not the caller — chooses that name and creates
 * the directory `0700`.
 *
 * So the one pattern that must not come back is a path built by string-joining a name onto
 * `os.tmpdir()`. `mkdtemp(join(tmpdir(), 'prefix-'))` is the sanctioned form and is allowed.
 *
 * Mirrors the floor slice 1 added for `dag-cli`; both are scoped to their own package until a
 * repo-wide harness scan takes over (SEC-003 follow-up).
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('SEC-003 floor: no insecure temp paths in agent-framework', () => {
  it('never string-joins a name onto os.tmpdir() outside of mkdtemp', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        // Only `join(tmpdir(), …)` matters; the `mkdtemp(join(tmpdir(), …))` wrapper is safe.
        if (!/\bjoin\(\s*tmpdir\(\)/.test(line)) return;
        if (/\bmkdtemp(Sync)?\s*\(/.test(line)) return;
        // An assertion that *names* the unsafe path is proving it is not used, not using it.
        if (/\bexpect\(/.test(line)) return;
        // This floor file quotes the pattern in its own documentation.
        if (file === fileURLToPath(import.meta.url)) return;
        offenders.push(`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('never hardcodes a writable "/tmp/..." path in non-test sources', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (file.includes('__tests__') || file.endsWith('.test.ts')) continue;
      const source = readFileSync(file, 'utf8');

      source.split('\n').forEach((line, index) => {
        if (/['"`]\/tmp\//.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
