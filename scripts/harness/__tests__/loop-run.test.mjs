/**
 * HARNESS-112 — the recorder that makes `escape=no-progress` checkable.
 *
 * Every refusal is asserted in BOTH directions. A recorder that accepts any terminal reason records
 * a vocabulary rather than a fact, and a recorder that refuses everything is discovered only when
 * someone needs it. The pairs below are what separate the two.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LEDGER_DIR,
  closeRun,
  ledgerSkills,
  main,
  openRun,
  permitsTerminal,
  readLedger,
  recordRound,
  terminalReasonNames,
} from '../loop-run.mjs';

/** A throwaway workspace whose only content is the skills this case needs. */
function workspace(skills) {
  const root = mkdtempSync(path.join(tmpdir(), 'loop-run-'));
  for (const [name, declaration] of Object.entries(skills)) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\nloop: ${declaration}\n---\n\n# ${name}\n\nRe-drive until the finding set stops changing.\n`,
      'utf8',
    );
  }
  return root;
}

const FINDING_SET = 'over=finding-set; escape=no-progress';
const ATTEMPT = 'over=attempt; bound=3 attempts';
const NOW = Date.parse('2026-08-19T01:00:00.000Z');

describe('openRun', () => {
  it('appends an OPEN entry and refuses a skill that declares no loop', () => {
    const root = workspace({ looper: FINDING_SET });
    mkdirSync(path.join(root, '.agents/skills/plain'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/plain/SKILL.md'),
      '---\nname: plain\n---\n\n# plain\n',
      'utf8',
    );

    const entry = openRun({ root, skill: 'looper', now: NOW });
    expect(entry.terminal).toBe(null);
    expect(readLedger(root, 'looper')).toHaveLength(1);
    expect(() => openRun({ root, skill: 'plain', now: NOW })).toThrow(/declares no `loop:`/);
  });

  it('refuses a second OPEN run, because two open runs cannot be told apart afterwards', () => {
    const root = workspace({ looper: FINDING_SET });
    openRun({ root, skill: 'looper', now: NOW });
    expect(() => openRun({ root, skill: 'looper', now: NOW })).toThrow(/already has run/);
  });
});

describe('recordRound', () => {
  it('makes the ARRAY the round count — no second stored number to diverge from it', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    recordRound({ root, skill: 'looper', runId, findings: 3 });
    const entry = recordRound({ root, skill: 'looper', runId, findings: 1 });
    expect(entry.roundFindings).toEqual([3, 1]);
    expect(Object.keys(entry)).not.toContain('rounds');
  });

  it('refuses a non-integer or negative finding count', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    expect(() => recordRound({ root, skill: 'looper', runId, findings: -1 })).toThrow(
      /non-negative integer/,
    );
    expect(() => recordRound({ root, skill: 'looper', runId, findings: 1.5 })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('closeRun', () => {
  it('seals the entry, and a later round or close on the same run is refused', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    recordRound({ root, skill: 'looper', runId, findings: 2 });
    const closed = closeRun({ root, skill: 'looper', runId, terminal: 'converged', now: NOW });
    expect(closed.terminal).toBe('converged');
    expect(() => recordRound({ root, skill: 'looper', runId, findings: 0 })).toThrow(
      /sealed record/,
    );
    expect(() =>
      closeRun({ root, skill: 'looper', runId, terminal: 'abandoned', now: NOW }),
    ).toThrow(/sealed record/);
  });

  it('permits `no-progress` only for a loop that declares that escape', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    const a = openRun({ root, skill: 'looper', now: NOW });
    expect(
      closeRun({ root, skill: 'looper', runId: a.runId, terminal: 'no-progress', now: NOW })
        .terminal,
    ).toBe('no-progress');
    const b = openRun({ root, skill: 'tries', now: NOW });
    expect(() =>
      closeRun({ root, skill: 'tries', runId: b.runId, terminal: 'no-progress', now: NOW }),
    ).toThrow(/escape=no-progress/);
  });

  it('permits `bound-reached` only for a loop that declares a NUMERIC bound', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    const a = openRun({ root, skill: 'tries', now: NOW });
    expect(
      closeRun({ root, skill: 'tries', runId: a.runId, terminal: 'bound-reached', now: NOW })
        .terminal,
    ).toBe('bound-reached');
    const b = openRun({ root, skill: 'looper', now: NOW });
    expect(() =>
      closeRun({ root, skill: 'looper', runId: b.runId, terminal: 'bound-reached', now: NOW }),
    ).toThrow(/NUMERIC bound/);
  });

  it('refuses a terminal reason outside the vocabulary, and names the vocabulary', () => {
    const root = workspace({ looper: FINDING_SET });
    const { runId } = openRun({ root, skill: 'looper', now: NOW });
    expect(() => closeRun({ root, skill: 'looper', runId, terminal: 'done', now: NOW })).toThrow(
      /converged/,
    );
  });

  it('accepts `abandoned` for every loop kind — that is what makes a dropped run visible', () => {
    const root = workspace({ looper: FINDING_SET, tries: ATTEMPT });
    for (const skill of ['looper', 'tries']) {
      const { runId } = openRun({ root, skill, now: NOW });
      expect(closeRun({ root, skill, runId, terminal: 'abandoned', now: NOW }).terminal).toBe(
        'abandoned',
      );
    }
  });
});

describe('permitsTerminal', () => {
  it('holds every vocabulary member reachable for some declaration', () => {
    expect(terminalReasonNames()).toEqual([
      'converged',
      'no-progress',
      'bound-reached',
      'halted-for-user',
      'abandoned',
    ]);
    for (const name of terminalReasonNames()) {
      const permitted =
        permitsTerminal({ over: 'finding-set', escape: 'no-progress' }, name).ok ||
        permitsTerminal({ over: 'attempt', bound: '3 attempts' }, name).ok;
      expect(permitted).toBe(true);
    }
  });
});

describe('readLedger', () => {
  it('THROWS on a line that does not parse, naming the file and line — never skips it', () => {
    const root = workspace({ looper: FINDING_SET });
    openRun({ root, skill: 'looper', now: NOW });
    const file = path.join(root, LEDGER_DIR, 'looper.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8') + 'not json\n', 'utf8');
    expect(() => readLedger(root, 'looper')).toThrow(/looper\.jsonl:2/);
  });

  it('reports no entries for a skill with no ledger, which is not an error', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(readLedger(root, 'looper')).toEqual([]);
    expect(ledgerSkills(root)).toEqual([]);
  });
});

describe('the CLI', () => {
  it('drives open → round → close and prints the round count from the array', () => {
    const root = workspace({ looper: FINDING_SET });
    const lines = [];
    const out = (text) => lines.push(text);
    expect(main(['open', '--loop', 'looper'], { root, now: NOW, out })).toBe(0);
    const runId = readLedger(root, 'looper')[0].runId;
    expect(
      main(['round', '--loop', 'looper', '--run', runId, '--findings', '2'], {
        root,
        now: NOW,
        out,
      }),
    ).toBe(0);
    expect(
      main(['close', '--loop', 'looper', '--run', runId, '--terminal', 'converged'], {
        root,
        now: NOW,
        out,
      }),
    ).toBe(0);
    expect(lines.at(-1)).toContain('CLOSED as `converged` after 1 round(s)');
    expect(existsSync(path.join(root, LEDGER_DIR, 'looper.jsonl'))).toBe(true);
  });

  it('refuses an unknown command rather than doing nothing quietly', () => {
    const root = workspace({ looper: FINDING_SET });
    expect(() =>
      main(['frobnicate', '--loop', 'looper'], { root, now: NOW, out: () => {} }),
    ).toThrow(/unknown command/);
  });
});
