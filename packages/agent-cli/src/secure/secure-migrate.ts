/**
 * `the product secure migrate [--dry-run]` and `secure compact` (#3679): put what this state root kept
 * in plaintext before secure mode under the keyring's key, and compact the prompt history.
 *
 * Both run only once secure mode is on, at a terminal, as a person's own commands: neither is a slash
 * command or a skill a model could run, neither is reachable through a transport, and a program the
 * model starts through its shell has no terminal to unlock at. Both unlock first: sealing needs only
 * the public key, but before an unlock that key is whatever the same-user-writable keyring file
 * holds, and migrating everything to a swapped key would hand everything over. A swapped key the unlock
 * finds is warned about before anything else, with `secure verify`'s exit statuses.
 *
 * `migrate` writes its marker before it looks for other product processes (`process-presence.ts`) and
 * refuses while one is alive, and at any other migration or compaction marker it cannot show gone; a
 * process whose state cannot be checked is listed, and continuing past it takes typing `proceed` —
 * after which nothing that process may be using is deleted. The plan and the caveat go to stdout,
 * since the secret terminal is wiped when it closes and what the person reads there would be gone;
 * nothing is written before the person answers on the terminal. `--dry-run` unlocks, prints the plan
 * and stops, writing nothing — the one write it can cause is the unlock's own repair of a swapped
 * sealing key, which it says. The steps run in order, each re-checking presence before it starts and
 * before it commits: a process that appears meanwhile stops the run, which is then incomplete and
 * safe to start again. The keys are locked again however the command ends, and a failure anywhere
 * after the unlock still ends with the status a repaired key calls for.
 *
 * `compact` is the history compaction alone, under a marker of its own: two compactions would each
 * rename over the other's file, so it refuses while another migration or compaction runs, and a
 * migration refuses while it runs. A process building a store meanwhile goes on: terminals append to
 * the history by path, the compaction catches up what they wrote meanwhile, and the history is a
 * derived copy of what the session records hold.
 *
 * Whatever a step must leave as it is while it still holds plaintext — a link, a file with another
 * name, the history among them — makes the run incomplete, and the summary says what to do first.
 */
import { createInterface } from 'node:readline/promises';

import { fingerprint } from '@robota-sdk/agent-keyring';

import {
  listProductPresence,
  writeProductMigrationMarker,
  type IPresenceEntry,
  type IProductMigrationMarker,
  type TProductMigrationMode,
} from '../product/process-presence.js';
import {
  compactProductPromptHistory,
  inspectProductPromptHistory,
} from '../product/session-stores.js';
import { userPaths } from '../product/user-paths.js';
import { KeyHolder, SealingKeyMismatchError } from './key-holder.js';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_SEALING_KEY_MISMATCH_INCOMPLETE,
  EXIT_SEALING_KEY_REPAIRED,
  describeMismatchFailure,
  fingerprintOf,
  mismatchOf,
  missingKeyring,
  warnSealingKeyMismatch,
  type ISecureOutput,
} from './sealing-key-warning.js';
import { createStoreMigrationSteps, type IStoreMigrationStepOptions } from './migration-steps.js';
import { unlockAtTerminal } from './secure-conversations.js';

import type { ISecretTerminalSession } from '../devices/secret-terminal.js';
import type { IKeyringStore } from './keyring-store.js';
import type {
  IMigrationContext,
  IMigrationStep,
  IMigrationStepOutcome,
  IMigrationStepReport,
} from './migration-step.js';
import type {
  TPromptHistoryCompaction,
  TPromptHistoryInspection,
  TPromptHistoryRefusal,
} from '@robota-sdk/agent-session';

export type {
  IMigrationContext,
  IMigrationStep,
  IMigrationStepOutcome,
  IMigrationStepReport,
} from './migration-step.js';

/** Something changed underneath, or a step stopped early: what is done is done, and a rerun finishes. */
export const EXIT_INCOMPLETE = 5;

/**
 * What the plan and the summary say about what migrating cannot do, one sentence per line. The
 * product's name is not in it: the same words hold for every product built on this.
 */
export const MIGRATION_CAVEAT: readonly string[] = Object.freeze([
  'Removing plaintext does not erase copies in filesystem snapshots (Time Machine, APFS/btrfs/ZFS snapshots), backups, cloud or dotfile sync, git history, copies already exported (OpenTelemetry content logs, hooks), or blocks an SSD/flash device keeps after deletion.',
  'File names, sizes, times and session ids stay visible; migrated payload files keep content-derived names.',
  'Processes the migration cannot see (older builds still running) may write plaintext again; quit every product window first.',
  'Not touched: curated project memory (`MEMORY.md`, `topics/`, shared through the repository by design), untrusted or non-Linux project roots (listed), peer files, sandbox quarantine, desktop browser drafts, SDK spill directories (listed), other or relocated state roots, earlier copies of the keyring.',
]);

/**
 * Said on macOS, where every flush the migration makes reaches only the drive's own cache: Node offers
 * no `F_FULLFSYNC`, so the order it writes in is all that protects what it rewrote from a power cut.
 */
export const MACOS_DURABILITY_CAVEAT =
  "On macOS the flushes it makes stop at the drive's own cache, so a power cut during the migration or right after it can still lose or tear a file it rewrote.";

const CONFIRM_QUESTION = 'Migrate now? [y/N] ';
const PROCEED_QUESTION =
  'Some processes above could not be checked. Type proceed to migrate anyway; anything else cancels: ';
const YES = /^y(es)?$/i;
const PROCEED = 'proceed';
const CANCELLED = 'Cancelled. Nothing was changed.\n';

/** A product process appeared while the migration ran; the run stops, incomplete. */
export class MigrationInterruptedError extends Error {
  readonly appeared: readonly IPresenceEntry[];

  constructor(appeared: readonly IPresenceEntry[]) {
    super('A product process started while the migration ran.');
    this.name = 'MigrationInterruptedError';
    this.appeared = appeared;
  }
}

export interface ISecureMigrateOptions extends ISecureOutput {
  /**
   * Asks `question` at this process's terminal and returns what was typed; defaults to asking on
   * stderr and reading the answer from stdin, which the command has checked is a terminal.
   */
  readonly confirm?: (question: string) => Promise<string>;
  /** The steps a migration runs, in order; defaults to {@link MIGRATION_STEPS}. */
  readonly migrationSteps?: readonly IMigrationStep[];
  /** The platform the caveat is for; defaults to this one. */
  readonly platform?: NodeJS.Platform;
}

function count(amount: number, noun: string, plural = `${noun}s`): string {
  return `${amount} ${amount === 1 ? noun : plural}`;
}

const WHERE: Partial<Record<NonNullable<IPresenceEntry['unknownBecause']>, string>> = {
  'other-pid-namespace': '; another pid namespace, same boot',
  'other-pid-namespace-unknown-boot': '; another pid namespace',
};

function describeProcess(entry: IPresenceEntry): string {
  const where = entry.unknownBecause === undefined ? '' : (WHERE[entry.unknownBecause] ?? '');
  return `pid ${entry.pid} (start time ${entry.startTime ?? 'not recorded'}, ${entry.mode}${where})`;
}

const HISTORY_REPLACED =
  'replaced by another compaction while this one ran, so this one replaced nothing; run this again.';
const HISTORY_REMOVED = 'removed while this compaction ran, so nothing was put in its place.';

function historyLeftAsItIs(path: string, reason: TPromptHistoryRefusal): string {
  const because = reason === 'hard-linked' ? 'it has another name too' : 'it is not a regular file';
  return (
    `Prompt history (${path}): left as it is, since ${because} (a link or a synced copy) and ` +
    'replacing it would leave the plaintext in place. Move it aside yourself, then run this again.'
  );
}

function describeInspection(inspection: TPromptHistoryInspection, path: string): string[] {
  if (inspection.status === 'missing') return ['Prompt history: there is none.'];
  if (inspection.status === 'refused') return [historyLeftAsItIs(path, inspection.reason)];
  const { plainLines, sealedLines, unreadableLines } = inspection;
  return [
    `Prompt history (${path}): ${count(plainLines + sealedLines + unreadableLines, 'line')} — ` +
      `${plainLines} plain, ${sealedLines} sealed, ${unreadableLines} that do not open here.`,
    '  Every entry is rewritten sealed, one per line, under one key; what does not open is kept as it is.',
  ];
}

function describeCompaction(
  result: Exclude<TPromptHistoryCompaction, { readonly status: 'refused' }>,
  path: string,
): IMigrationStepOutcome {
  if (result.status === 'missing')
    return { lines: ['Prompt history: there is none.'], complete: true };
  if (result.status === 'replaced') {
    return { lines: [`Prompt history (${path}): ${HISTORY_REPLACED}`], complete: false };
  }
  // Deleted meanwhile, its plaintext went with it.
  if (result.status === 'removed') {
    return { lines: [`Prompt history (${path}): ${HISTORY_REMOVED}`], complete: true };
  }
  const caughtUp = result.caughtUp === 0 ? '' : `, ${result.caughtUp} appended meanwhile`;
  const lines = [
    `Prompt history (${path}): ${count(result.entries, 'entry', 'entries')} sealed, one per line, ` +
      `under one key (${result.fromPlain} were plain${caughtUp}).`,
  ];
  if (result.carriedOver > 0) {
    lines.push(`  ${count(result.carriedOver, 'line')} that do not open here kept as they are.`);
  }
  if (result.droppedTail) {
    lines.push('  An unfinished line at the end, which no reader shows, was dropped.');
  }
  if (result.plainLinesAfter > 0) {
    lines.push(
      `  ${count(result.plainLinesAfter, 'plain line')} reached it meanwhile from a process this ` +
        'command cannot see (an older build); quit it and run this again.',
    );
  }
  if (result.catchUpFailed !== undefined) {
    lines.push(
      `  The catch-up stopped (${result.catchUpFailed.reason}) with ` +
        `${count(result.catchUpFailed.unreadBytes, 'byte')} appended to the replaced history unread; ` +
        'those prompts are still in their session records.',
    );
  }
  return {
    lines,
    complete: result.plainLinesAfter === 0 && result.catchUpFailed === undefined,
  };
}

/** Compacts the prompt history: what `secure compact` does alone and the first thing a migration does. */
const promptHistoryStep: IMigrationStep = {
  title: 'the prompt history',
  plan: (context) => ({
    lines: describeInspection(
      inspectProductPromptHistory(context.productRuntime, context.holder),
      userPaths(context.productRuntime).history,
    ),
  }),
  run: async (context) => {
    const path = userPaths(context.productRuntime).history;
    const result = await compactProductPromptHistory(context.productRuntime, context.holder, {
      beforeCommit: context.recheckPresence,
    });
    // Left as it is, the history still holds its plaintext: the run is not complete.
    if (result.status === 'refused') {
      return { lines: [historyLeftAsItIs(path, result.reason)], complete: false };
    }
    return describeCompaction(result, path);
  },
};

/**
 * What a migration converts, in order: the prompt history first (the compaction `secure compact`
 * runs alone), then the stores `migration-steps.ts` converts — the user's session records, the
 * subagent transcripts, the trusted projects' state — and last the leftovers.
 */
export function createMigrationSteps(
  options: IStoreMigrationStepOptions = {},
): readonly IMigrationStep[] {
  return Object.freeze([promptHistoryStep, ...createStoreMigrationSteps(options)]);
}

/** What a migration converts, in order (see {@link createMigrationSteps}). */
export const MIGRATION_STEPS: readonly IMigrationStep[] = createMigrationSteps();

function caveat(platform: NodeJS.Platform): string[] {
  const sentences =
    platform === 'darwin' ? [...MIGRATION_CAVEAT, MACOS_DURABILITY_CAVEAT] : MIGRATION_CAVEAT;
  return ['Caveat:', ...sentences.map((sentence) => `  ${sentence}`)];
}

function renderPlan(
  options: ISecureMigrateOptions,
  reports: readonly IMigrationStepReport[],
  others: readonly IPresenceEntry[],
  dryRun: boolean,
): string {
  const runtime = options.productRuntime;
  const lines = [`${runtime.vocabulary.cliName} secure migrate${dryRun ? ' --dry-run' : ''}: plan`];
  for (const report of reports) lines.push(...report.lines.map((line) => `  ${line}`));
  const alive = others.filter((entry) => entry.liveness === 'alive');
  const unknown = others.filter((entry) => entry.liveness === 'unknown');
  if (alive.length > 0) {
    lines.push(
      'These processes use the stored conversations, and a migration refuses while they run:',
    );
    lines.push(...alive.map((entry) => `  ${describeProcess(entry)}`));
  }
  if (unknown.length > 0) {
    lines.push(
      'These processes could not be checked (another container, or no start time); continuing past them takes typing proceed:',
    );
    lines.push(...unknown.map((entry) => `  ${describeProcess(entry)}`));
  }
  lines.push(
    `Quit every ${runtime.vocabulary.displayName} window before you continue, including ones started by an older build and ones that said they could not mark themselves: those are not visible here and may write plaintext again.`,
    ...caveat(options.platform ?? process.platform),
  );
  return `${lines.join('\n')}\n`;
}

function renderSummary(
  options: ISecureMigrateOptions,
  results: readonly string[],
  ending: 'done' | 'incomplete' | 'failed',
): string {
  const cliName = options.productRuntime.vocabulary.cliName;
  const lines = [`${cliName} secure migrate: ${ending}`, ...results.map((line) => `  ${line}`)];
  if (ending === 'incomplete') {
    lines.push(
      `Something changed while it ran, a step stopped early, or something above must be moved aside first; then run \`${cliName} secure migrate\` again to finish.`,
    );
  }
  lines.push(...caveat(options.platform ?? process.platform));
  return `${lines.join('\n')}\n`;
}

async function confirmOnTerminal(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

/**
 * Unlocks `holder` at the terminal as `secure verify` does. Returns the exit status when the command
 * ends here, or whether a swapped sealing key was found and repaired (the warning already shown).
 */
async function unlockForWriting(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  holder: KeyHolder,
  options: ISecureOutput,
): Promise<number | { readonly repaired: boolean }> {
  const before = store.load();
  if (before.status === 'missing') return missingKeyring(store, options);
  let opened: Awaited<ReturnType<typeof unlockAtTerminal>>;
  try {
    opened = await terminalSession.run((terminal) =>
      unlockAtTerminal(terminal, holder, 'passphrase'),
    );
  } catch (error) {
    if (!(error instanceof SealingKeyMismatchError)) throw error;
    options.stderr(
      `${describeMismatchFailure(error, options.productRuntime.vocabulary.cliName)}\n`,
    );
    warnSealingKeyMismatch(store, options, mismatchOf(error));
    return EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
  }
  if (opened === undefined) {
    options.stderr('The keyring was not unlocked. Nothing was changed.\n');
    return EXIT_FAILED;
  }
  if (opened.sealingKey !== 'repaired') return { repaired: false };
  const repaired = warnSealingKeyMismatch(store, options, {
    stored: fingerprintOf(before.keyring),
    derived: fingerprint(holder.sealingPublicKey()),
  });
  // Sealing follows the verified key either way; a file still holding another key stops the command.
  return repaired ? { repaired: true } : EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
}

/** `secure verify`'s rule: a repaired key makes a completed command exit 2, any other ending 4. */
function withRepair(code: number, repaired: boolean): number {
  if (!repaired) return code;
  return code === EXIT_OK ? EXIT_SEALING_KEY_REPAIRED : EXIT_SEALING_KEY_MISMATCH_INCOMPLETE;
}

async function planSteps(
  steps: readonly IMigrationStep[],
  context: IMigrationContext,
): Promise<IMigrationStepReport[]> {
  const reports: IMigrationStepReport[] = [];
  for (const step of steps) reports.push(await step.plan(context));
  return reports;
}

/** Runs `work`; a failure is said on stderr, with nothing changed, and answers `EXIT_FAILED`. */
async function orFailed<T>(
  options: ISecureOutput,
  what: string,
  work: () => Promise<T>,
): Promise<T | typeof EXIT_FAILED> {
  try {
    return await work();
  } catch (error) {
    options.stderr(
      `${what} (${error instanceof Error ? error.name : 'unknown'}). Nothing was changed.\n`,
    );
    return EXIT_FAILED;
  }
}

async function dryRun(
  holder: KeyHolder,
  steps: readonly IMigrationStep[],
  options: ISecureMigrateOptions,
  repaired: boolean,
): Promise<number> {
  const runtime = options.productRuntime;
  const others = listProductPresence(runtime, { sweep: false });
  const reports = await orFailed(options, 'The plan could not be made', () =>
    planSteps(steps, {
      productRuntime: runtime,
      holder,
      recheckPresence: () => {},
      mayDeleteLeftovers: !others.some((entry) => entry.liveness === 'unknown'),
      startedAt: Date.now(),
    }),
  );
  if (reports === EXIT_FAILED) return EXIT_FAILED;
  options.stdout(renderPlan(options, reports, others, true));
  options.stdout(
    repaired
      ? 'Dry run: nothing else was changed; unlocking repaired the keyring file, as the warning says.\n'
      : 'Dry run: nothing was changed.\n',
  );
  return EXIT_OK;
}

async function runSteps(
  steps: readonly IMigrationStep[],
  context: IMigrationContext,
): Promise<{ readonly results: string[]; readonly ending: 'done' | 'incomplete' | 'failed' }> {
  const results: string[] = [];
  let incomplete = false;
  for (const step of steps) {
    try {
      context.recheckPresence();
      const outcome = await step.run(context);
      results.push(...outcome.lines);
      if (!outcome.complete) incomplete = true;
    } catch (error) {
      if (!(error instanceof MigrationInterruptedError)) {
        results.push(
          `Stopped at ${step.title}: it failed (${error instanceof Error ? error.name : 'unknown'}).`,
        );
        return { results, ending: 'failed' };
      }
      results.push(
        `Stopped before changing ${step.title}: ${count(error.appeared.length, 'process', 'processes')} started meanwhile:`,
        ...error.appeared.map((entry) => `  ${describeProcess(entry)}`),
      );
      return { results, ending: 'incomplete' };
    }
  }
  return { results, ending: incomplete ? 'incomplete' : 'done' };
}

/**
 * Refuses, on stderr, while another process stands in the way: one alive, or another migration or
 * compaction it cannot show gone. Returns whether it refused.
 */
function refuseOthers(
  found: readonly IPresenceEntry[],
  options: ISecureOutput,
  doing: string,
): boolean {
  const displayName = options.productRuntime.vocabulary.displayName;
  const migrations = found.filter((entry) => entry.kind === 'migration');
  const alive = found.filter((entry) => entry.kind === 'process' && entry.liveness === 'alive');
  if (migrations.length > 0) {
    options.stderr(
      [
        `Another migration or compaction of the stored conversations is running, or cannot be shown to have ended; run ${doing} again once it has (remove its marker yourself only if you are sure none runs). Nothing was changed.`,
        ...migrations.map((entry) => `  ${describeProcess(entry)}: ${entry.path}`),
      ].join('\n') + '\n',
    );
    return true;
  }
  if (alive.length > 0) {
    options.stderr(
      [
        `Other ${displayName} processes are using the stored conversations; quit them and run ${doing} again. Nothing was changed.`,
        ...alive.map((entry) => `  ${describeProcess(entry)}`),
      ].join('\n') + '\n',
    );
    return true;
  }
  return false;
}

async function migrateUnder(
  marker: IProductMigrationMarker,
  holder: KeyHolder,
  steps: readonly IMigrationStep[],
  options: ISecureMigrateOptions,
): Promise<number> {
  const runtime = options.productRuntime;
  const found = marker.others();
  if (refuseOthers(found, options, 'this')) return EXIT_FAILED;
  // What is left are processes that cannot be checked, accepted only by typing `proceed`; anything
  // else that appears stops the run.
  const accepted = new Set(found.map((entry) => entry.path));
  const context: IMigrationContext = {
    productRuntime: runtime,
    holder,
    mayDeleteLeftovers: found.length === 0,
    startedAt: marker.writtenAt,
    recheckPresence: () => {
      const appeared = marker
        .others()
        .filter((entry) => entry.liveness === 'alive' || !accepted.has(entry.path));
      if (appeared.length > 0) throw new MigrationInterruptedError(appeared);
    },
  };
  const reports = await orFailed(options, 'The plan could not be made', () =>
    planSteps(steps, context),
  );
  if (reports === EXIT_FAILED) return EXIT_FAILED;
  options.stdout(renderPlan(options, reports, found, false));
  const needsProceed = found.length > 0;
  const answer = await orFailed(options, 'The answer could not be read', async () =>
    (
      await (options.confirm ?? confirmOnTerminal)(
        needsProceed ? PROCEED_QUESTION : CONFIRM_QUESTION,
      )
    ).trim(),
  );
  if (answer === EXIT_FAILED) return EXIT_FAILED;
  if (needsProceed ? answer !== PROCEED : !YES.test(answer)) {
    options.stderr(CANCELLED);
    return EXIT_FAILED;
  }
  const { results, ending } = await runSteps(steps, context);
  options.stdout(renderSummary(options, results, ending));
  if (ending === 'failed') return EXIT_FAILED;
  return ending === 'incomplete' ? EXIT_INCOMPLETE : EXIT_OK;
}

/** Writes the marker of a migration or a compaction, or says on stderr why it could not be written. */
function markerOrRefusal(
  options: ISecureOutput,
  mode: TProductMigrationMode,
): IProductMigrationMarker | undefined {
  try {
    return writeProductMigrationMarker(options.productRuntime, { mode });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    options.stderr(
      `The ${mode === 'secure compact' ? 'compaction' : 'migration'} marker could not be written in ${options.productRuntime.layout.userPaths.presence} (${code}). Nothing was changed.\n`,
    );
    return undefined;
  }
}

/** `secure migrate [--dry-run]`, once the dispatcher has checked secure mode and the terminal. */
export async function runSecureMigrate(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  dryRunOnly: boolean,
  options: ISecureMigrateOptions,
): Promise<number> {
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  let marker: IProductMigrationMarker | undefined;
  try {
    const unlocked = await unlockForWriting(store, terminalSession, holder, options);
    if (typeof unlocked === 'number') return unlocked;
    const steps = options.migrationSteps ?? MIGRATION_STEPS;
    if (dryRunOnly) {
      return withRepair(await dryRun(holder, steps, options, unlocked.repaired), unlocked.repaired);
    }
    marker = markerOrRefusal(options, 'secure migrate');
    if (marker === undefined) return withRepair(EXIT_FAILED, unlocked.repaired);
    return withRepair(await migrateUnder(marker, holder, steps, options), unlocked.repaired);
  } finally {
    marker?.release();
    holder.lock('explicit');
  }
}

/** `secure compact`, once the dispatcher has checked secure mode and the terminal. */
export async function runSecureCompact(
  store: IKeyringStore,
  terminalSession: ISecretTerminalSession,
  options: ISecureOutput,
): Promise<number> {
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  let marker: IProductMigrationMarker | undefined;
  try {
    const unlocked = await unlockForWriting(store, terminalSession, holder, options);
    if (typeof unlocked === 'number') return unlocked;
    marker = markerOrRefusal(options, 'secure compact');
    if (marker === undefined) return withRepair(EXIT_FAILED, unlocked.repaired);
    const others = marker.others().filter((entry) => entry.kind === 'migration');
    if (refuseOthers(others, options, 'this')) return withRepair(EXIT_FAILED, unlocked.repaired);
    const runtime = options.productRuntime;
    const path = userPaths(runtime).history;
    const result = await orFailed(options, 'The compaction failed', () =>
      compactProductPromptHistory(runtime, holder),
    );
    if (result === EXIT_FAILED) return withRepair(EXIT_FAILED, unlocked.repaired);
    if (result.status === 'refused') {
      options.stderr(`${historyLeftAsItIs(path, result.reason)}\n`);
      return withRepair(EXIT_INCOMPLETE, unlocked.repaired);
    }
    const outcome = describeCompaction(result, path);
    options.stdout(`${outcome.lines.join('\n')}\n`);
    return withRepair(outcome.complete ? EXIT_OK : EXIT_INCOMPLETE, unlocked.repaired);
  } finally {
    marker?.release();
    holder.lock('explicit');
  }
}
