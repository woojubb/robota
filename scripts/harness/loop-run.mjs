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
 *   node scripts/harness/loop-run.mjs expect --loop <skill> --run <id> --phase <phase> --agent <agent> --subject <subject> --token <signal> [--cells <id,id>]
 *   node scripts/harness/loop-run.mjs coverage --loop <skill> --run <id> --agent <agent> --subject <subject> --cells <id,id>
 *   node scripts/harness/loop-run.mjs observe --loop <skill> --run <id> --phase <phase> --agent <agent> --subject <subject> --signal '<terminal-line>'
 *   node scripts/harness/loop-run.mjs pass-through --loop <skill> --run <id> --id <finding-id>
 *   node scripts/harness/loop-run.mjs draft-finding --loop <skill> --run <id> --id <finding-id> --severity <level>
 *   node scripts/harness/loop-run.mjs final-finding --loop <skill> --run <id> --id <finding-id> --severity <level>
 *   node scripts/harness/loop-run.mjs foundational --loop <skill> --run <id> --id <finding-id>
 *   node scripts/harness/loop-run.mjs reconcile-route --loop <skill> --run <id> --id <finding-id> --action <filed|reused|updated> --target <root-id> [--site <task-path>] [--evidence <text>]
 *   node scripts/harness/loop-run.mjs disposition --loop <skill> --run <id> --id <finding-id> --outcome <outcome> [--target <id>] [--site <path>] [--evidence <text>]
 *   node scripts/harness/loop-run.mjs link --loop <skill> --run <id> --nested-run <id>
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

import {
  architectureExpectationError,
  normalizeArchitectureRefreshMetadata,
} from './architecture-refresh-record.mjs';
import { parseDeclaration } from './scan-loop-contract.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
export const LEDGER_DIR = '.agents/loop-runs';
const SKILLS_DIR = '.agents/skills';
const ARCHITECTURE_PROTOCOL_SKILLS = new Set(['architecture-audit-fanout', 'architecture-refresh']);

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
      const entry = JSON.parse(line);
      // Schema-evolution default: a sealed proof is never semantically amended merely because a
      // later protocol adds an empty evidence collection. Readers expose the new neutral value and
      // the next canonical write persists it for open records.
      if (entry.extensions?.architectureRefresh !== undefined)
        normalizeArchitectureRefreshMetadata(entry);
      entries.push(entry);
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
    extensions: {},
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

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`loop-run: --${field} must be a non-empty string.`);
  }
  return value.trim();
}

function architectureMetadata(entry) {
  return normalizeArchitectureRefreshMetadata(entry);
}

function currentRound(entry) {
  return entry.roundFindings.length + 1;
}

function parseCells(cells) {
  if (cells === undefined || cells === null) return [];
  const values = (Array.isArray(cells) ? cells : String(cells).split(','))
    .map((cell) => requireText(cell, 'cells'))
    .filter(Boolean);
  if (new Set(values).size !== values.length) {
    throw new Error('loop-run: --cells contains a duplicate cell id.');
  }
  return values;
}

function requireArchitectureProtocolSkill(skill, allowed = ARCHITECTURE_PROTOCOL_SKILLS) {
  if (!ARCHITECTURE_PROTOCOL_SKILLS.has(skill) || !allowed.has(skill)) {
    throw new Error(
      `loop-run: this architecture protocol command is not owned by \`${skill}\`; its registered validator cannot prove that field.`,
    );
  }
}

export function recordSignalExpectation({
  root,
  skill,
  runId,
  phase,
  agent,
  subject,
  token,
  cells,
}) {
  requireArchitectureProtocolSkill(skill);
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  const expectation = {
    round: currentRound(entries[index]),
    phase: requireText(phase, 'phase'),
    agent: requireText(agent, 'agent'),
    subject: requireText(subject, 'subject'),
    token: requireText(token, 'token'),
  };
  const protocolError = architectureExpectationError(skill, expectation);
  if (protocolError !== null) throw new Error(`loop-run: ${protocolError}.`);
  if (
    metadata.signalExpectations.some(
      (item) =>
        item.round === expectation.round &&
        item.phase === expectation.phase &&
        item.agent === expectation.agent &&
        item.subject === expectation.subject,
    )
  ) {
    throw new Error(
      `loop-run: signal expectation already exists for ${expectation.agent}/${expectation.subject} in round ${expectation.round}.`,
    );
  }
  const expectedCells = parseCells(cells);
  if (expectedCells.length > 0) expectation.cells = expectedCells;
  metadata.signalExpectations.push(expectation);
  writeLedger(root, skill, entries);
  return entries[index];
}

export function recordSignalObservation({ root, skill, runId, phase, agent, subject, signal }) {
  requireArchitectureProtocolSkill(skill);
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  const observed = {
    round: currentRound(entries[index]),
    phase: requireText(phase, 'phase'),
    agent: requireText(agent, 'agent'),
    subject: requireText(subject, 'subject'),
    signal: requireText(signal, 'signal'),
  };
  const matches = metadata.signalExpectations.filter(
    (item) =>
      item.round === observed.round &&
      item.phase === observed.phase &&
      item.agent === observed.agent &&
      item.subject === observed.subject,
  );
  if (matches.length !== 1) {
    throw new Error(
      `loop-run: observe requires exactly one prior expectation for ${observed.agent}/${observed.subject} in round ${observed.round}; found ${matches.length}.`,
    );
  }
  if (
    metadata.signalObservations.some(
      (item) =>
        item.round === observed.round &&
        item.phase === observed.phase &&
        item.agent === observed.agent &&
        item.subject === observed.subject,
    )
  ) {
    throw new Error(
      `loop-run: observation already exists for ${observed.agent}/${observed.subject} in round ${observed.round}.`,
    );
  }
  metadata.signalObservations.push(observed);
  writeLedger(root, skill, entries);
  return entries[index];
}

export function recordCoverageCells({ root, skill, runId, agent, subject, cells }) {
  requireArchitectureProtocolSkill(skill, new Set(['architecture-audit-fanout']));
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  const round = currentRound(entries[index]);
  const normalizedAgent = requireText(agent, 'agent');
  const normalizedSubject = requireText(subject, 'subject');
  const matching = metadata.signalExpectations.filter(
    (item) =>
      item.round === round &&
      item.agent === normalizedAgent &&
      item.subject === normalizedSubject &&
      item.token === 'AUDIT-DIM-COMPLETE',
  );
  if (matching.length !== 1) {
    throw new Error(
      `loop-run: coverage requires exactly one AUDIT-DIM-COMPLETE expectation for ${normalizedAgent}/${normalizedSubject} in round ${round}.`,
    );
  }
  if (Array.isArray(matching[0].cells) && matching[0].cells.length > 0) {
    throw new Error(
      `loop-run: coverage cells are already recorded for ${normalizedSubject} in round ${round}.`,
    );
  }
  const expectedCells = parseCells(cells);
  if (expectedCells.length === 0) throw new Error('loop-run: --cells must name at least one cell.');
  matching[0].cells = expectedCells;
  writeLedger(root, skill, entries);
  return entries[index];
}

function recordUniqueId({ root, skill, runId, field, id }) {
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const normalized = requireText(id, 'id');
  const round = currentRound(entries[index]);
  const metadata = architectureMetadata(entries[index]);
  if (metadata[field].some((item) => item.round === round && item.id === normalized)) {
    throw new Error(`loop-run: ${field} already contains id \`${normalized}\` in round ${round}.`);
  }
  metadata[field].push({ round, id: normalized });
  writeLedger(root, skill, entries);
  return entries[index];
}

export function recordVerificationPassThrough(args) {
  requireArchitectureProtocolSkill(args.skill, new Set(['architecture-refresh']));
  return recordUniqueId({ ...args, field: 'verificationPassThroughIds' });
}

export function recordFoundationalId(args) {
  requireArchitectureProtocolSkill(args.skill, new Set(['architecture-refresh']));
  return recordUniqueId({ ...args, field: 'foundationalIds' });
}

export function recordReconciliationRoute({
  root,
  skill,
  runId,
  id,
  action,
  target,
  site = null,
  evidence = null,
}) {
  requireArchitectureProtocolSkill(skill, new Set(['architecture-refresh']));
  const normalizedAction = requireText(action, 'action');
  if (!['filed', 'reused', 'updated'].includes(normalizedAction)) {
    throw new Error(
      `loop-run: reconciliation action must be filed, reused or updated, got \`${normalizedAction}\`.`,
    );
  }
  if (['filed', 'updated'].includes(normalizedAction) && (site === null || evidence === null)) {
    throw new Error(
      `loop-run: ${normalizedAction} reconciliation route requires --site and --evidence proof.`,
    );
  }
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  const round = currentRound(entries[index]);
  const normalizedId = requireText(id, 'id');
  if (
    metadata.reconciliationRoutes.some((item) => item.round === round && item.id === normalizedId)
  ) {
    throw new Error(
      `loop-run: reconciliation route already exists for \`${normalizedId}\` in round ${round}.`,
    );
  }
  metadata.reconciliationRoutes.push({
    round,
    id: normalizedId,
    action: normalizedAction,
    target: requireText(target, 'target'),
    site: site === null ? null : requireText(site, 'site'),
    evidence: evidence === null ? null : requireText(evidence, 'evidence'),
  });
  writeLedger(root, skill, entries);
  return entries[index];
}

export function recordFinding({ root, skill, runId, stage, id, severity }) {
  requireArchitectureProtocolSkill(skill, new Set(['architecture-refresh']));
  if (!['draft', 'final'].includes(stage)) {
    throw new Error(`loop-run: finding stage must be draft or final, got \`${stage}\`.`);
  }
  const normalizedSeverity = requireText(severity, 'severity');
  if (!['blocker', 'high', 'medium'].includes(normalizedSeverity)) {
    throw new Error(
      `loop-run: material finding severity must be blocker, high or medium, got \`${normalizedSeverity}\`.`,
    );
  }
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const round = currentRound(entries[index]);
  const metadata = architectureMetadata(entries[index]);
  const field = stage === 'draft' ? 'draftFindings' : 'finalFindings';
  const normalizedId = requireText(id, 'id');
  if (metadata[field].some((item) => item.round === round && item.id === normalizedId)) {
    throw new Error(
      `loop-run: ${field} already contains id \`${normalizedId}\` in round ${round}.`,
    );
  }
  metadata[field].push({ round, id: normalizedId, severity: normalizedSeverity });
  writeLedger(root, skill, entries);
  return entries[index];
}

export function recordDisposition({
  root,
  skill,
  runId,
  id,
  outcome,
  target = null,
  site = null,
  evidence = null,
}) {
  requireArchitectureProtocolSkill(skill, new Set(['architecture-refresh']));
  const normalizedOutcome = requireText(outcome, 'outcome');
  if (!['corrected', 'contained', 'invalid'].includes(normalizedOutcome)) {
    throw new Error(
      `loop-run: disposition outcome must be corrected, contained or invalid, got \`${normalizedOutcome}\`.`,
    );
  }
  if (
    normalizedOutcome === 'contained' &&
    (target === null || site === null || evidence === null)
  ) {
    throw new Error(
      'loop-run: contained disposition requires --target, --site and --evidence claim proof.',
    );
  }
  if (normalizedOutcome === 'invalid' && (site === null || evidence === null)) {
    throw new Error('loop-run: invalid disposition requires --site and --evidence source fact.');
  }
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  metadata.dispositions.push({
    round: currentRound(entries[index]),
    id: requireText(id, 'id'),
    outcome: normalizedOutcome,
    target: target === null ? null : requireText(target, 'target'),
    site: site === null ? null : requireText(site, 'site'),
    evidence: evidence === null ? null : requireText(evidence, 'evidence'),
  });
  writeLedger(root, skill, entries);
  return entries[index];
}

export function linkNestedRun({ root, skill, runId, nestedRunId }) {
  requireArchitectureProtocolSkill(skill, new Set(['architecture-refresh']));
  const entries = readLedger(root, skill);
  const index = requireOpen(entries, skill, runId);
  const metadata = architectureMetadata(entries[index]);
  const round = currentRound(entries[index]);
  const existing = metadata.nestedRuns.find((item) => item.round === round);
  if (existing !== undefined) {
    throw new Error(
      `loop-run: run \`${runId}\` already links nested run \`${existing.runId}\` in round ${round}.`,
    );
  }
  metadata.nestedRuns.push({ round, runId: requireText(nestedRunId, 'nested-run') });
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
    phase: undefined,
    agent: undefined,
    subject: undefined,
    token: undefined,
    signal: undefined,
    id: undefined,
    outcome: undefined,
    target: null,
    nestedRun: undefined,
    cells: undefined,
    severity: undefined,
    site: null,
    evidence: null,
    action: undefined,
  };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--loop') args.loop = argv[++i];
    else if (argv[i] === '--run') args.run = argv[++i];
    else if (argv[i] === '--findings') args.findings = Number(argv[++i]);
    else if (argv[i] === '--terminal') args.terminal = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--phase') args.phase = argv[++i];
    else if (argv[i] === '--agent') args.agent = argv[++i];
    else if (argv[i] === '--subject') args.subject = argv[++i];
    else if (argv[i] === '--token') args.token = argv[++i];
    else if (argv[i] === '--signal') args.signal = argv[++i];
    else if (argv[i] === '--id') args.id = argv[++i];
    else if (argv[i] === '--outcome') args.outcome = argv[++i];
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--nested-run') args.nestedRun = argv[++i];
    else if (argv[i] === '--cells') args.cells = argv[++i];
    else if (argv[i] === '--severity') args.severity = argv[++i];
    else if (argv[i] === '--site') args.site = argv[++i];
    else if (argv[i] === '--evidence') args.evidence = argv[++i];
    else if (argv[i] === '--action') args.action = argv[++i];
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
    case 'expect': {
      const entry = recordSignalExpectation({
        root,
        skill: args.loop,
        runId: args.run,
        phase: args.phase,
        agent: args.agent,
        subject: args.subject,
        token: args.token,
        cells: args.cells,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} expects ${args.token} from ${args.agent}.`);
      return 0;
    }
    case 'observe': {
      const entry = recordSignalObservation({
        root,
        skill: args.loop,
        runId: args.run,
        phase: args.phase,
        agent: args.agent,
        subject: args.subject,
        signal: args.signal,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} observed a signal from ${args.agent}.`);
      return 0;
    }
    case 'coverage': {
      const entry = recordCoverageCells({
        root,
        skill: args.loop,
        runId: args.run,
        agent: args.agent,
        subject: args.subject,
        cells: args.cells,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} records coverage cells for ${args.subject}.`);
      return 0;
    }
    case 'pass-through': {
      const entry = recordVerificationPassThrough({
        root,
        skill: args.loop,
        runId: args.run,
        id: args.id,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} passes through ${args.id}.`);
      return 0;
    }
    case 'draft-finding':
    case 'final-finding': {
      const stage = args.command === 'draft-finding' ? 'draft' : 'final';
      const entry = recordFinding({
        root,
        skill: args.loop,
        runId: args.run,
        stage,
        id: args.id,
        severity: args.severity,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} records ${stage} finding ${args.id}.`);
      return 0;
    }
    case 'foundational': {
      const entry = recordFoundationalId({
        root,
        skill: args.loop,
        runId: args.run,
        id: args.id,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} marks ${args.id} FOUNDATIONAL.`);
      return 0;
    }
    case 'reconcile-route': {
      const entry = recordReconciliationRoute({
        root,
        skill: args.loop,
        runId: args.run,
        id: args.id,
        action: args.action,
        target: args.target,
        site: args.site,
        evidence: args.evidence,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} records reconciliation route for ${args.id}.`);
      return 0;
    }
    case 'disposition': {
      const entry = recordDisposition({
        root,
        skill: args.loop,
        runId: args.run,
        id: args.id,
        outcome: args.outcome,
        target: args.target,
        site: args.site,
        evidence: args.evidence,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} records ${args.id} as ${args.outcome}.`);
      return 0;
    }
    case 'link': {
      const entry = linkNestedRun({
        root,
        skill: args.loop,
        runId: args.run,
        nestedRunId: args.nestedRun,
      });
      out(`loop-run: ${args.loop} run ${entry.runId} links nested run ${args.nestedRun}.`);
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
        `loop-run: unknown command \`${args.command ?? '(none)'}\`. Use open, expect, coverage, observe, pass-through, draft-finding, final-finding, foundational, reconcile-route, disposition, link, round, close or show.`,
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
