/**
 * HARNESS-113 — the floor that makes a new loop prove itself.
 *
 * The order of the cases is the argument. TC-02 asserts the floor CAN fail before anything asserts it
 * passes, because a floor whose red is never demonstrated is the unfalsifiable check this repository
 * keeps finding one layer up. Each satisfying route is then asserted to actually satisfy it, and the
 * anti-rot direction is asserted last so the exemption cannot outlive its need.
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { LEDGER_DIR } from '../loop-run.mjs';
import { examinedSkillCount, findLoopProofFindings } from '../scan-loop-proof.mjs';

const FINDING_SET = 'over=finding-set; escape=no-progress';

function workspace(skills) {
  const root = makeTemp('loop-proof-');
  for (const [name, front] of Object.entries(skills)) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\n${front}\n---\n\n# ${name}\n\nRe-drive until nothing changes.\n`,
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

const run = (terminal) => ({
  runId: 'r1',
  opened: '2026-08-18T00:00:00.000Z',
  closed: terminal === null ? null : '2026-08-18T01:00:00.000Z',
  roundFindings: [1],
  terminal,
  ref: null,
});

describe('findLoopProofFindings', () => {
  it('FAILS an unproven loop-driving skill — the red proof this floor rests on', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    const findings = findLoopProofFindings(root, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].skill).toBe('looper');
    expect(findings[0].detail).toMatch(/never been proven/);
  });

  it('passes it once its ledger holds a CLOSED run', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    ledger(root, 'looper', [run('converged')]);
    expect(findLoopProofFindings(root, [])).toEqual([]);
  });

  it('does NOT accept an open run as proof — a run that has not ended proves no ending', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    ledger(root, 'looper', [run(null)]);
    expect(findLoopProofFindings(root, [])).toHaveLength(1);
  });

  it('accepts `proof: none — <reason>` and refuses an empty reason', () => {
    const withReason = workspace({
      looper: `loop: ${FINDING_SET}\nproof: none — needs a live npm OTP prompt`,
    });
    expect(findLoopProofFindings(withReason, [])).toEqual([]);

    const without = workspace({ looper: `loop: ${FINDING_SET}\nproof: none —` });
    const findings = findLoopProofFindings(without, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/no reason after the dash/);
  });

  it('passes a frozen skill, and FAILS one that is frozen yet now has a closed run (anti-rot)', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    expect(findLoopProofFindings(root, ['looper'])).toEqual([]);
    ledger(root, 'looper', [run('converged')]);
    const findings = findLoopProofFindings(root, ['looper']);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/remove it from/);
  });

  it('FAILS a baseline entry that drives no loop any more', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    ledger(root, 'looper', [run('converged')]);
    const findings = findLoopProofFindings(root, ['ghost']);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/drives no loop any more/);
  });

  it('FAILS an unparseable ledger rather than reading it as "no runs yet"', () => {
    const root = workspace({ looper: `loop: ${FINDING_SET}` });
    ledger(root, 'looper', [run('converged')]);
    appendFileSync(path.join(root, LEDGER_DIR, 'looper.jsonl'), '{ broken\n', 'utf8');
    expect(findLoopProofFindings(root, [])[0].detail).toMatch(/looper\.jsonl:2/);
  });

  it('exempts an `over=delegated` skill and ignores a skill that declares no loop', () => {
    const root = workspace({
      referrer: 'loop: over=delegated; owner=looper',
      plain: 'invocable: true',
    });
    expect(findLoopProofFindings(root, [])).toEqual([]);
  });

  it('THROWS over a root with no skills tree — absence is not emptiness (HARNESS-052)', () => {
    const bare = makeTemp('loop-proof-bare-');
    expect(() => findLoopProofFindings(bare, [])).toThrow(/\.agents\/skills missing/);
  });
});

describe('the published examined size', () => {
  it('counts the loop-driving skills JUDGED, excluding delegated and non-loop skills', () => {
    const root = workspace({
      a: `loop: ${FINDING_SET}`,
      b: 'loop: over=attempt; bound=2 attempts',
      referrer: 'loop: over=delegated; owner=a',
      plain: 'invocable: true',
    });
    findLoopProofFindings(root, ['a', 'b']);
    expect(examinedSkillCount()).toBe(2);
  });

  it('starts from zero on a SECOND sweep, so the size is this run and not the sum of runs', () => {
    const two = workspace({ a: `loop: ${FINDING_SET}`, b: `loop: ${FINDING_SET}` });
    findLoopProofFindings(two, ['a', 'b']);
    const one = workspace({ a: `loop: ${FINDING_SET}` });
    findLoopProofFindings(one, ['a']);
    expect(examinedSkillCount()).toBe(1);
  });
});
