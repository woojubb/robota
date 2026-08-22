/**
 * HARNESS-112 — the guard that keeps a loop-run ledger meaning something.
 *
 * Both directions for every refusal: a clean ledger must pass, or the guard is a wall nobody can
 * satisfy; and each malformed shape must fail, or it is a wall that isn't there. The staleness case
 * takes an injected clock rather than the wall clock, so it asserts the horizon rather than the day
 * the suite happens to run.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { LEDGER_DIR } from '../loop-run.mjs';
import {
  STALE_OPEN_DAYS,
  examinedEntryCount,
  findLoopRunRecordFindings,
} from '../scan-loop-run-records.mjs';

const NOW = Date.parse('2026-08-19T01:00:00.000Z');
const FINDING_SET = 'over=finding-set; escape=no-progress';
const ATTEMPT = 'over=attempt; bound=3 attempts';

function workspace(skills, { wireRecorder = true } = {}) {
  const root = makeTemp('loop-records-');
  for (const [name, declaration] of Object.entries(skills)) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
    const recorder = wireRecorder
      ? `\n\nRecord the run: \`node scripts/harness/loop-run.mjs open --loop ${name}\`.\n`
      : '\n';
    writeFileSync(
      path.join(root, '.agents/skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\nloop: ${declaration}\n---\n\n# ${name}\n\nRe-drive until nothing changes.${recorder}`,
      'utf8',
    );
  }
  return root;
}

function ledger(root, skill, entries) {
  mkdirSync(path.join(root, LEDGER_DIR), { recursive: true });
  writeFileSync(
    path.join(root, LEDGER_DIR, `${skill}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
}

const closed = (runId, roundFindings, terminal, opened = '2026-08-18T00:00:00.000Z') => ({
  runId,
  opened,
  closed: '2026-08-18T01:00:00.000Z',
  roundFindings,
  terminal,
  ref: null,
});

describe('findLoopRunRecordFindings', () => {
  it('passes a coherent ledger', () => {
    const root = workspace({ looper: FINDING_SET });
    ledger(root, 'looper', [
      closed('r1', [3, 1, 0], 'converged'),
      closed('r2', [2, 2], 'no-progress'),
    ]);
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
  });

  it('fails a ledger whose filename names no loop-declaring skill', () => {
    const root = workspace({ looper: FINDING_SET });
    ledger(root, 'ghost', [closed('r1', [1], 'converged')]);
    const findings = findLoopRunRecordFindings(root, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].ledger).toContain('ghost.jsonl');
  });

  it('fails a malformed line naming the file and line, and does not skip it', () => {
    const root = workspace({ looper: FINDING_SET });
    ledger(root, 'looper', [closed('r1', [1], 'converged')]);
    appendFileSync(path.join(root, LEDGER_DIR, 'looper.jsonl'), '{ not json\n', 'utf8');
    const findings = findLoopRunRecordFindings(root, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/looper\.jsonl:2/);
  });

  it('fails a terminal reason the declaration cannot reach', () => {
    const root = workspace({ tries: ATTEMPT });
    ledger(root, 'tries', [closed('r1', [1], 'no-progress')]);
    expect(findLoopRunRecordFindings(root, NOW)[0].detail).toMatch(/escape=no-progress/);
  });

  it('fails an entry left OPEN past the staleness horizon, and passes one inside it', () => {
    const root = workspace({ looper: FINDING_SET });
    const stale = new Date(NOW - (STALE_OPEN_DAYS + 1) * 86_400_000).toISOString();
    const fresh = new Date(NOW - 86_400_000).toISOString();
    ledger(root, 'looper', [
      { runId: 'r1', opened: fresh, closed: null, roundFindings: [], terminal: null, ref: null },
    ]);
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
    ledger(root, 'looper', [
      { runId: 'r1', opened: stale, closed: null, roundFindings: [], terminal: null, ref: null },
    ]);
    expect(findLoopRunRecordFindings(root, NOW)[0].detail).toMatch(/abandoned/);
  });

  it('fails a duplicate runId and a non-integer round-findings entry', () => {
    const root = workspace({ looper: FINDING_SET });
    ledger(root, 'looper', [closed('r1', [1], 'converged'), closed('r1', ['x'], 'converged')]);
    const details = findLoopRunRecordFindings(root, NOW)
      .map((f) => f.detail)
      .join(' | ');
    expect(details).toMatch(/more than once/);
    expect(details).toMatch(/non-negative integers/);
  });
});

describe('the published examined size', () => {
  it('counts every entry the sweep READ, not the ledgers it opened', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    ledger(root, 'looper', [closed('r1', [1], 'converged'), closed('r2', [1], 'converged')]);
    ledger(root, 'tries', [closed('r3', [1], 'bound-reached')]);
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
    expect(examinedEntryCount()).toBe(3);
  });

  it('starts from zero on a SECOND sweep, so the size is this run and not the sum of runs', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    ledger(root, 'looper', [closed('r1', [1], 'converged'), closed('r2', [1], 'converged')]);
    ledger(root, 'tries', [closed('r3', [1], 'bound-reached')]);
    findLoopRunRecordFindings(root, NOW);
    const single = workspace({ looper: FINDING_SET });
    ledger(single, 'looper', [closed('r1', [1], 'converged')]);
    findLoopRunRecordFindings(single, NOW);
    expect(examinedEntryCount()).toBe(1);
  });
});

describe('the recording instruction lives in the skill that is read', () => {
  it('FAILS a loop-driving skill whose body never names the recorder — the red proof for this check', () => {
    const root = workspace({ looper: FINDING_SET }, { wireRecorder: false });
    const findings = findLoopRunRecordFindings(root, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].ledger).toContain('looper/SKILL.md');
    expect(findings[0].detail).toMatch(/loop-run\.mjs/);
  });

  it('passes the same skill once its body names the recorder', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
  });

  it('exempts an `over=delegated` skill, which refers to a loop it does not drive', () => {
    const root = workspace({ referrer: 'over=delegated; owner=looper' }, { wireRecorder: false });
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
  });

  it('does not fire on a skill that declares no loop at all', () => {
    const root = makeTemp('loop-records-');
    mkdirSync(path.join(root, '.agents/skills/plain'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/plain/SKILL.md'),
      '---\nname: plain\n---\n\n# plain\n',
      'utf8',
    );
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
  });
});

describe('the governed tree', () => {
  it('THROWS over a root with no skills tree — absence is not emptiness (HARNESS-052)', () => {
    const bare = makeTemp('loop-records-bare-');
    expect(() => findLoopRunRecordFindings(bare, NOW)).toThrow(/\.agents\/skills missing/);
  });

  it('does NOT require the ledger directory — no run recorded yet is a legitimate state', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(findLoopRunRecordFindings(root, NOW)).toEqual([]);
    expect(examinedEntryCount()).toBe(0);
  });
});
