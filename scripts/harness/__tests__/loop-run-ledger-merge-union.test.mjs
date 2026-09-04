/**
 * Issue #2400 — the append-only ledgers under `.agents/loop-runs/` merge themselves.
 *
 * Every run appends one line to a ledger's tail, so two branches that each appended conflicted on
 * rebase although both sides were correct. `.gitattributes` now hands those files to git's built-in
 * `union` driver, which keeps both sides' lines. The attribute is checked through git itself —
 * `git check-attr` is what the merge machinery consults — rather than by reading the file, so a
 * pattern that looks right and matches nothing is a failure here.
 *
 * The JSON ratchet baselines are deliberately NOT covered: `union` over a JSON object yields a file
 * no reader can parse. That exclusion is pinned too, because widening the pattern to `*.json` is the
 * obvious wrong "fix" the next time a baseline conflicts.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LEDGER_DIR = '.agents/loop-runs';

function mergeAttribute(file) {
  const out = execFileSync('git', ['check-attr', 'merge', '--', file], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  // `<path>: merge: <value>`
  return out.trim().split(': ').at(-1);
}

describe('append-only ledgers use the union merge driver (issue #2400)', () => {
  const ledgers = readdirSync(path.join(WORKSPACE_ROOT, LEDGER_DIR)).filter((name) =>
    name.endsWith('.jsonl'),
  );

  it('the ledger directory holds at least one .jsonl ledger (the subject is not empty)', () => {
    expect(ledgers.length).toBeGreaterThan(0);
  });

  it('every existing ledger resolves merge=union through git', () => {
    for (const name of ledgers) {
      expect(mergeAttribute(`${LEDGER_DIR}/${name}`), name).toBe('union');
    }
  });

  it('a ledger that does not exist yet still resolves merge=union (the pattern, not a list)', () => {
    expect(mergeAttribute(`${LEDGER_DIR}/not-yet-written-skill.jsonl`)).toBe('union');
  });

  it('JSON ratchet baselines are NOT union-merged — union over a JSON object is unparseable', () => {
    for (const baseline of [
      'scripts/harness/file-size-baseline.json',
      'scripts/harness/examined-adoption-baseline.json',
      'scripts/harness/progress-report-acknowledgments.json',
    ]) {
      expect(mergeAttribute(baseline), baseline).not.toBe('union');
    }
  });

  it('a union of two appends is still one JSON record per line — what the ledger readers require', () => {
    const base = ['{"runId":"r1","skill":"a"}'];
    const ours = [...base, '{"runId":"r2","skill":"a"}'];
    const theirs = [...base, '{"runId":"r3","skill":"a"}'];
    // The union driver's result: base lines, then each side's additions, no markers.
    const merged = [...base, ...ours.slice(base.length), ...theirs.slice(base.length)];
    expect(merged.map((line) => JSON.parse(line).runId)).toEqual(['r1', 'r2', 'r3']);
  });
});
