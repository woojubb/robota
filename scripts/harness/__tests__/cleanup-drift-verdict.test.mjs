import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * HARNESS-069 — a script that could only succeed.
 *
 * `cleanup-drift.mjs` contained neither `process.exit` nor `process.exitCode` — zero matches for
 * either — so whatever it found, a caller heard success. Its intent was never ambiguous: the JSON
 * report it writes carries `passed: driftCount === 0`, so the verdict existed and was simply not
 * published. "Silence is not success" is a rule of this harness, and this was the one script that
 * could not break it.
 *
 * It is deliberately NOT registered as a gate — it is `pnpm harness:cleanup`, run by hand, absent
 * from `run-all-scans` and from every workflow. The finding as filed called it vacuous "if it is
 * registered as a gate"; it is not, which makes it smaller than it read. Worth recording in both
 * directions.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const BASELINE = path.join(ROOT, 'scripts/harness/cleanup-drift-baseline.json');
const backups = [];

afterEach(() => {
  for (const [file, contents] of backups.splice(0)) writeFileSync(file, contents);
});

function withBaseline(mutate) {
  const original = readFileSync(BASELINE, 'utf8');
  backups.push([BASELINE, original]);
  const frozen = JSON.parse(original);
  mutate(frozen);
  writeFileSync(BASELINE, `${JSON.stringify(frozen, null, 2)}\n`);
}

function run() {
  return spawnSync('node', ['scripts/harness/cleanup-drift.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

describe('cleanup-drift publishes its verdict (HARNESS-069)', () => {
  it('exits 0 when drift matches the frozen counts', () => {
    const result = run();
    expect(result.status).toBe(0);
  });

  it('(RED) exits NON-ZERO when drift grew', () => {
    // Against the defect this exits 0 with the findings printed — the whole point of the item.
    withBaseline((frozen) => {
      const [firstType] = Object.keys(frozen);
      frozen[firstType] = 0;
    });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift GREW/);
  });

  it('(RED) exits NON-ZERO when drift fell without a re-freeze', () => {
    // A ratchet that only catches growth lets a gain evaporate silently.
    withBaseline((frozen) => {
      const [firstType] = Object.keys(frozen);
      frozen[firstType] = 9999;
    });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift FELL/);
  });

  it('the frozen baseline is the one the script actually measures', () => {
    // A number nobody can reproduce is not a baseline. The pass above already proves agreement;
    // this pins that the file is non-empty, so an emptied one cannot masquerade as a clean tree.
    const frozen = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(Object.keys(frozen).length).toBeGreaterThan(0);
  });

  it('is NOT registered as a gate — that is the recorded decision, not an oversight', () => {
    // The finding said it would be vacuous *if* registered. Pinning the "not registered" half means a
    // later registration has to come past this case and reckon with the ratchet first.
    const registry = readFileSync(path.join(ROOT, 'scripts/harness/run-all-scans.mjs'), 'utf8');
    expect(registry).not.toContain('cleanup-drift.mjs');
  });
});
