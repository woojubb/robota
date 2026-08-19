#!/usr/bin/env node

/**
 * HARNESS-112 — what a loop run actually did, recorded where something can read it.
 *
 * ## Why this exists
 *
 * `scan-loop-contract.mjs` requires every loop-driving skill to declare its kind and its escape, and
 * eleven of the sixteen declare `escape=no-progress`. Measured when this file was written, the string
 * `no-progress` occurred in exactly TWO files in the tree: that scan, and that scan's own test. The
 * scan can establish that the declaration is written and that the skill's body describes it — that is
 * the furthest a check whose only input is the tree can go, and HARNESS-071 already went there. It
 * cannot reach a run, so `escape=no-progress` was a claim nothing could check.
 *
 * A loop that converged, one that exhausted, and one that was abandoned at round 1 left a
 * byte-identical tree. This is what makes them different afterwards.
 *
 * ## What a record is, and is not
 *
 * METADATA about a run — which loop, when, how many findings each round returned, and how it ended.
 * Never a transcript. That boundary is the OpenTelemetry GenAI convention's, where content capture is
 * opt-in precisely because prompts and tool arguments carry sensitive data, and these ledgers are
 * committed.
 *
 * ## The round count is not stored
 *
 * An entry carries `roundFindings: [n, n, …]` and NO round count. Every reader takes
 * `roundFindings.length`. A stored count would be a second source for one quantity — they agree until
 * the day they do not, which is `measurement-provenance.md` clause 1 — and not storing it makes the
 * divergence impossible rather than merely checked.
 *
 * ## The ceiling, stated rather than implied
 *
 * A run that is never opened leaves no line, and no check over the tree can see it. This file makes a
 * run RECORDABLE; HARNESS-113 is what makes recording one a condition of registering a new loop.
 *
 * Usage:
 *   node scripts/harness/loop-run.mjs open  --loop <skill>
 *   node scripts/harness/loop-run.mjs round --loop <skill> --run <id> --findings <n>
 *   node scripts/harness/loop-run.mjs close --loop <skill> --run <id> --terminal <reason> [--ref <text>]
 *   node scripts/harness/loop-run.mjs show  --loop <skill>
 *
 * Exit 0 = recorded, 1 = refused.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

import { parseDeclaration } from './scan-loop-contract.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
export const LEDGER_DIR = '.agents/loop-runs';
const SKILLS_DIR = '.agents/skills';

/**
 * How a run may end. A CLOSED vocabulary, derived from Temporal's closed-status set and reduced to
 * what `loop-contract` already distinguishes. Each member's `requires` names the declaration that has
 * to be present for it to be reachable at all — recording a terminal state the loop cannot reach is a
 * record describing some other loop.
 */
export const TERMINAL_REASONS = {
  converged: { requires: null, why: 'the finding set emptied, or the goal held' },
  'no-progress': { requires: 'escape', why: 'a round returned what the previous round returned' },
  'bound-reached': { requires: 'bound', why: 'the declared numeric bound was hit' },
  'halted-for-user': { requires: null, why: 'escalated to a person' },
  abandoned: { requires: null, why: 'stopped without reaching any of the above' },
};

/**
 * `abandoned` is the member that carries this file's whole point, and it is Temporal's
 * "not-closed is a STATE, not an absence" applied here: without it, a loop that was quietly dropped is
 * indistinguishable from one that was never opened — the collapse `enforcement-architecture.md`
 * § "Silence is not success" forbids one layer up.
 */
export function terminalReasonNames() {
  return Object.keys(TERMINAL_REASONS);
}

/** The `loop:` declaration of a skill, or undefined when it declares none. */
export function readLoopDeclaration(root, skill) {
  const file = path.join(root, SKILLS_DIR, skill, 'SKILL.md');
  if (!existsSync(file)) return undefined;
  return parseDeclaration(readFileSync(file, 'utf8'));
}

/** Whether a declaration permits a terminal reason, and why not when it does not. */
export function permitsTerminal(declaration, reason) {
  const member = TERMINAL_REASONS[reason];
  if (member === undefined) {
    return {
      ok: false,
      why: `\`${reason}\` is not a terminal reason. Use one of: ${terminalReasonNames().join(', ')}.`,
    };
  }
  if (member.requires === 'escape' && declaration?.escape !== 'no-progress') {
    return {
      ok: false,
      why:
        `\`${reason}\` is only reachable for a loop declaring \`escape=no-progress\`; this one declares ` +
        `\`escape=${declaration?.escape ?? '(none)'}\`. A terminal state the loop cannot reach describes some other loop.`,
    };
  }
  if (member.requires === 'bound' && !/\d/.test(declaration?.bound ?? '')) {
    return {
      ok: false,
      why:
        `\`${reason}\` is only reachable for a loop declaring a NUMERIC bound; this one declares ` +
        `\`bound=${declaration?.bound ?? '(none)'}\`.`,
    };
  }
  return { ok: true, why: '' };
}

function ledgerPath(root, skill) {
  return path.join(root, LEDGER_DIR, `${skill}.jsonl`);
}

/**
 * Every entry of one ledger, in file order.
 *
 * A line that does not parse THROWS naming the file and its line number. It is never skipped: a
 * ledger the reader cannot read is not an empty ledger, and dropping the line would shrink every
 * denominator computed from it in the one direction that flatters the result.
 */
export function readLedger(root, skill) {
  const file = ledgerPath(root, skill);
  if (!existsSync(file)) return [];
  const rel = path.relative(root, file);
  const entries = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${rel}:${i + 1} is not a JSON object (${error.message})`);
    }
  }
  return entries;
}

/** Ledgers present under the ledger directory, by the skill name each is named for. */
export function ledgerSkills(root) {
  const dir = path.join(root, LEDGER_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .sort();
}

function writeLedger(root, skill, entries) {
  const dir = path.join(root, LEDGER_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    ledgerPath(root, skill),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
}

/* ------------------------------------------------------------------ operations */

/** A run identifier. Derived from the clock the caller supplies, so a test can pin it. */
export function makeRunId(now) {
  return `r${new Date(now)
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
}

export function openRun({ root, skill, now }) {
  const declaration = readLoopDeclaration(root, skill);
  if (declaration === undefined) {
    throw new Error(
      `loop-run: \`${skill}\` declares no \`loop:\` frontmatter (or has no SKILL.md). Only a loop-driving skill has runs to record.`,
    );
  }
  const existing = readLedger(root, skill);
  const open = existing.find((e) => e.terminal === null);
  if (open !== undefined) {
    throw new Error(
      `loop-run: \`${skill}\` already has run \`${open.runId}\` OPEN. Close it before opening another — two open runs cannot be told apart afterwards.`,
    );
  }
  let runId = makeRunId(now);
  const taken = new Set(existing.map((e) => e.runId));
  for (let n = 2; taken.has(runId); n += 1) runId = `${makeRunId(now)}-${n}`;
  const entry = {
    runId,
    opened: new Date(now).toISOString(),
    closed: null,
    roundFindings: [],
    terminal: null,
    ref: null,
  };
  mkdirSync(path.join(root, LEDGER_DIR), { recursive: true });
  appendFileSync(ledgerPath(root, skill), JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

function requireOpen(entries, skill, runId) {
  const index = entries.findIndex((e) => e.runId === runId);
  if (index === -1) throw new Error(`loop-run: \`${skill}\` has no run \`${runId}\`.`);
  if (entries[index].terminal !== null) {
    throw new Error(
      `loop-run: run \`${runId}\` was closed as \`${entries[index].terminal}\`. A sealed record is not amended — open a new run.`,
    );
  }
  return index;
}

export function recordRound({ root, skill, runId, findings }) {
  if (!Number.isInteger(findings) || findings < 0) {
    throw new Error(`loop-run: --findings must be a non-negative integer, got \`${findings}\`.`);
  }
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  entries[index].roundFindings.push(findings);
  writeLedger(root, skill, entries);
  return entries[index];
}

export function closeRun({ root, skill, runId, terminal, ref = null, now }) {
  const declaration = readLoopDeclaration(root, skill);
  const permitted = permitsTerminal(declaration, terminal);
  if (!permitted.ok) throw new Error(`loop-run: ${permitted.why}`);
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  entries[index].closed = new Date(now).toISOString();
  entries[index].terminal = terminal;
  entries[index].ref = ref;
  writeLedger(root, skill, entries);
  return entries[index];
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const args = {
    command: argv[0],
    loop: undefined,
    run: undefined,
    findings: undefined,
    terminal: undefined,
    ref: null,
  };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--loop') args.loop = argv[++i];
    else if (argv[i] === '--run') args.run = argv[++i];
    else if (argv[i] === '--findings') args.findings = Number(argv[++i]);
    else if (argv[i] === '--terminal') args.terminal = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else throw new Error(`loop-run: unknown argument \`${argv[i]}\``);
  }
  if (!args.loop) throw new Error('loop-run: --loop <skill> is required');
  return args;
}

export function main(
  argv = process.argv.slice(2),
  { root = WORKSPACE_ROOT, now = undefined, out = console.log } = {},
) {
  const clock = now ?? Date.now();
  const args = parseArgs(argv);
  switch (args.command) {
    case 'open': {
      const entry = openRun({ root, skill: args.loop, now: clock });
      out(`loop-run: ${args.loop} run ${entry.runId} OPEN — record each round, then close it.`);
      return 0;
    }
    case 'round': {
      const entry = recordRound({
        root,
        skill: args.loop,
        runId: args.run,
        findings: args.findings,
      });
      out(
        `loop-run: ${args.loop} run ${entry.runId} round ${entry.roundFindings.length} — ${args.findings} finding(s).`,
      );
      return 0;
    }
    case 'close': {
      const entry = closeRun({
        root,
        skill: args.loop,
        runId: args.run,
        terminal: args.terminal,
        ref: args.ref,
        now: clock,
      });
      out(
        `loop-run: ${args.loop} run ${entry.runId} CLOSED as \`${entry.terminal}\` after ${entry.roundFindings.length} round(s).`,
      );
      return 0;
    }
    case 'show': {
      for (const entry of readLedger(root, args.loop)) {
        out(
          `${entry.runId}  ${entry.roundFindings.length} round(s)  ${entry.terminal ?? 'OPEN'}` +
            `  findings=[${entry.roundFindings.join(',')}]${entry.ref ? `  ref=${entry.ref}` : ''}`,
        );
      }
      return 0;
    }
    default:
      throw new Error(
        `loop-run: unknown command \`${args.command ?? '(none)'}\`. Use open, round, close or show.`,
      );
  }
}

const isDirectExecution = process.argv[1] !== undefined && process.argv[1].endsWith('loop-run.mjs');
if (isDirectExecution) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
