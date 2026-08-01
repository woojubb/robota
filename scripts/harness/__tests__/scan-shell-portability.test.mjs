import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findPortabilityFindings } from '../scan-shell-portability.mjs';

/**
 * The mechanical half of "Host Platform Is Read, Never Assumed" (operational.md). A checked-in
 * script runs on whatever machine clones the repo, and the flags below fail on the other OS WITHOUT
 * naming their cause — `sed -i` on macOS reports success while eating the next argument.
 */
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'portability-'));
  roots.push(root);
  for (const dir of ['scripts', '.husky', '.claude/hooks'])
    mkdirSync(path.join(root, dir), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe('scan-shell-portability', () => {
  it('flags each GNU-only flag that fails silently on the other platform', () => {
    const root = fixture({
      'scripts/a.sh': 'sed -i "s/a/b/" f\n',
      'scripts/b.sh': 'readlink -f "$1"\n',
      'scripts/c.sh': 'stat -c %Y f\n',
      'scripts/d.sh': "date -d '1 day ago'\n",
      'scripts/e.sh': 'grep -P "\\d" f\n',
      'scripts/f.sh': 'base64 -w0 f\n',
      'scripts/g.sh': 'find . -name x -printf "%p"\n',
      'scripts/h.sh': 'echo x | xargs -r rm\n',
    });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => f.flag).sort()).toEqual([
      'base64 -w',
      'date -d',
      'find -printf',
      'grep -P',
      'readlink -f',
      'sed -i',
      'stat -c',
      'xargs -r',
    ]);
  });

  it('leaves the portable spellings alone', () => {
    const root = fixture({
      'scripts/ok.sh': 'sed "s/a/b/" f > f.new\ngrep -E "[0-9]" f\nbase64 f\n',
      '.husky/pre-commit': 'pnpm lint-staged\n',
      '.claude/hooks/guard.sh': 'node scripts/x.mjs\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // STATED LIMIT, pinned so it cannot drift back silently. The first version scanned `.mjs` too and
  // refused a JS STRING LITERAL describing this very scan — a flag named in prose inside a string is
  // indistinguishable from one being run without evaluating the file, and a guard that fires on
  // correct work is one people learn to route around.
  it('examines shell files only, and a JS string naming a flag is not a finding', () => {
    const root = fixture({
      'scripts/prose.mjs': "const why = 'sed -i eats the next argument on macOS';\n",
      'scripts/real.sh': 'sed -i "s/a/b/" f\n',
    });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => f.file)).toEqual([path.join('scripts', 'real.sh')]);
  });

  it('does not flag a COMMENT — prose that discusses a flag does not run it', () => {
    const root = fixture({
      'scripts/doc.sh': '# sed -i is banned here, use node\n  // readlink -f likewise\nexit 0\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  it('excludes test fixture trees, and REPORTS that it did', () => {
    const root = fixture({ 'scripts/__tests__/fx.sh': 'sed -i "s/a/b/" f\n' });
    const { findings, skipped } = findPortabilityFindings(root);
    expect(findings).toEqual([]);
    expect(skipped).toContain(path.join('scripts', '__tests__'));
  });

  it('reports the SIZE of what it examined, so a pass over nothing is visible', () => {
    const root = fixture({ 'scripts/a.sh': 'echo hi\n', 'scripts/b.sh': 'echo ho\n' });
    expect(findPortabilityFindings(root).filesExamined).toBeGreaterThanOrEqual(2);
  });

  it('REFUSES to pass over a tree it cannot read', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'portability-empty-'));
    roots.push(root);
    expect(() => findPortabilityFindings(root)).toThrow(/governed tree\(s\) absent/);
  });

  it('the real repository is clean, so this scan is a ratchet and not a backlog', () => {
    const { findings, filesExamined } = findPortabilityFindings(
      path.resolve(import.meta.dirname, '../../..'),
    );
    expect(filesExamined).toBeGreaterThan(20);
    expect(findings).toEqual([]);
  });
});
