/**
 * The steps of `secure migrate` that convert the conversation stores (#3679), after the prompt
 * history: the user's session records, the subagent transcripts, the trusted projects' state (their
 * records, replay logs, edit checkpoints and pending memory candidates), and the leftovers nothing
 * reads again. Each store's format stays with the store — these call the converters the SDK packages
 * keep beside them — and each step plans read-only with the same walk it runs, so a dry run says
 * exactly what a run would do. Every converter re-checks presence before each commit point, and every
 * deletion of a leftover passes the context's one gate. A file a step refuses — a link, a file with
 * another name, anything not regular — keeps whatever it holds, so it leaves the run incomplete until
 * the person moves it aside, as the summary says.
 */
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import {
  migrateSubagentTranscripts,
  migrateWorkspaceEditCheckpoints,
  migrateWorkspaceProjectSessionLogs,
  migrateWorkspaceProjectSessionRecords,
} from '@robota-sdk/agent-framework/node';
import { migrateNodeSessionStore } from '@robota-sdk/agent-session/node';

import { adoptMigratedSessionRecords } from '../product/session-stores.js';
import { KeyHolderArtifactSealer } from './artifact-sealer.js';
import { sweepMigrationLeftovers } from './migration-leftovers.js';
import { discoverProjectRoots } from './migration-roots.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { ILeftovers } from './migration-leftovers.js';
import type { IListedProjectRoot, ITrustedProjectRoot } from './migration-roots.js';
import type { TMigratedSessionStore } from '../product/session-stores.js';
import type {
  IMigratedSessions,
  IMigratedSessionsMarked,
  IMigrationContext,
  IMigrationStep,
  IMigrationStepOutcome,
  IUnmarkedSessions,
} from './migration-step.js';
import type {
  IEditCheckpointMigration,
  IWorkspaceSessionLogMigration,
  IWorkspaceSessionRecordMigration,
} from '@robota-sdk/agent-framework/node';
import type { ISessionLogMigration, ISessionRecordMigration } from '@robota-sdk/agent-session/node';

/** How many paths a line names before it says how many more there are. */
const NAMED_PATHS = 5;
const PENDING_MEMORY_FILE = 'pending.json';
/** What the person does about the files a step refused, before running it again. */
const MOVE_REFUSED_ASIDE =
  'Move each aside, or remove its other name, yourself; then run this again.';

export interface IStoreMigrationStepOptions {
  /** The shared temporary directory earlier builds left files in; defaults to this process's. */
  readonly temporaryDirectory?: string;
  /** The platform whose project writes are judged; defaults to this one. */
  readonly platform?: NodeJS.Platform;
  /** Now, in milliseconds, for judging leftovers' age; defaults to the clock. */
  readonly now?: () => number;
}

type TTense = 'plan' | 'done';

function count(amount: number, noun: string, plural = `${noun}s`): string {
  return `${amount} ${amount === 1 ? noun : plural}`;
}

/** `  <label>: <paths>`, naming a few and counting the rest; nothing for no paths. */
function named(label: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const more = paths.length - NAMED_PATHS;
  return [
    `  ${label}: ${paths.slice(0, NAMED_PATHS).join(', ')}${more > 0 ? `, and ${more} more` : ''}.`,
  ];
}

function verb(tense: TTense, planned: string, done: string): string {
  return tense === 'plan' ? planned : done;
}

/** Runs `work` with a sealer of its own over the run's holder, disposed afterwards. */
async function withSealer<T>(
  context: IMigrationContext,
  work: (sealer: KeyHolderArtifactSealer) => T | Promise<T>,
): Promise<T> {
  const sealer = new KeyHolderArtifactSealer(context.holder);
  try {
    return await work(sealer);
  } finally {
    sealer.dispose();
  }
}

/** The records a run sealed in one store, and where that store is, as the person is told it. */
interface IMigratedBatch {
  readonly target: TMigratedSessionStore;
  readonly where: string;
  readonly records: readonly { readonly id: string; readonly digest: string }[];
}

/**
 * The records a run sealed in each store, as the person may then mark them as theirs: raised with a
 * sealer of their own over the run's holder, which is still unlocked. Each store is marked on its own,
 * so one that cannot be reached is named and the others are still marked. Absent when none were sealed.
 */
function migratedSessions(
  context: IMigrationContext,
  batches: readonly IMigratedBatch[],
): IMigratedSessions | undefined {
  const count = batches.reduce((sum, batch) => sum + batch.records.length, 0);
  if (count === 0) return undefined;
  return {
    count,
    adopt: (): IMigratedSessionsMarked => {
      const sealer = new KeyHolderArtifactSealer(context.holder);
      const marked = { adopted: 0, locked: 0, changed: 0 };
      const held: string[] = [];
      const unmarked: IUnmarkedSessions[] = [];
      try {
        for (const batch of batches) {
          try {
            const result = adoptMigratedSessionRecords(batch.target, sealer, batch.records);
            marked.adopted += result.adopted;
            marked.locked += result.locked;
            marked.changed += result.changed;
            held.push(...result.held);
            if (result.failed > 0) {
              unmarked.push({
                where: batch.where,
                count: result.failed,
                failure: result.failure ?? 'unknown',
              });
            }
          } catch (error) {
            unmarked.push({
              where: batch.where,
              count: batch.records.length,
              failure: error instanceof Error ? error.name : 'unknown',
            });
          }
        }
        return { ...marked, held, unmarked };
      } finally {
        sealer.dispose();
      }
    },
  };
}

/** The options every converter of a run takes. */
function converting(context: IMigrationContext, sealer: KeyHolderArtifactSealer, apply: boolean) {
  return {
    sealer,
    apply,
    beforeCommit: context.recheckPresence,
    sweepTemporaries: context.mayDeleteLeftovers,
    migrationStartedAt: context.startedAt,
  };
}

/** The lines every converter result shares: what was left alone, and why. */
function leftAlone(result: {
  readonly unopenable?: readonly string[];
  readonly unsafeNames?: readonly string[];
  readonly refused?: readonly string[];
  readonly overCap?: readonly string[];
  readonly changed?: readonly string[];
  readonly held?: readonly string[];
}): string[] {
  return [
    ...named(
      'Left as they are, since they are open in another process; close it, or release a session whose process ended with session release, then run this again',
      result.held ?? [],
    ),
    ...named(
      'Left as they are, since they do not open here (other keys, damaged, or sealed by a newer build)',
      result.unopenable ?? [],
    ),
    ...named('Left as they are, since their names are not session ids', result.unsafeNames ?? []),
    ...named(
      'Not followed or replaced (links, files with another name, or not regular files), so what they hold is still there',
      result.refused ?? [],
    ),
    ...((result.refused ?? []).length > 0 ? [`  ${MOVE_REFUSED_ASIDE}`] : []),
    ...named(
      'Left plain, since sealed they would be past the project read limit',
      result.overCap ?? [],
    ),
    ...named('Changed while being sealed, so left for the next run', result.changed ?? []),
  ];
}

/** What a converter found of crashed writes' temp files; kept, not removed, when a process may still use them. */
function temporaries(amount: number, tense: TTense, mayDelete: boolean): string[] {
  if (amount === 0) return [];
  if (!mayDelete) {
    return [
      `  ${count(amount, 'temp file')} of crashed writes left as ${amount === 1 ? 'it is' : 'they are'}, since some processes could not be checked and may still be writing ${amount === 1 ? 'it' : 'them'}.`,
    ];
  }
  return [
    `  ${count(amount, 'temp file')} of crashed writes ${verb(tense, 'to remove', 'removed')}.`,
  ];
}

function describeRecords(
  label: string,
  result: ISessionRecordMigration | IWorkspaceSessionRecordMigration,
  tense: TTense,
  mayDelete: boolean,
): string[] {
  return [
    `${label}: ${count(result.sealed, 'plain record')} ${verb(tense, 'to seal', 'sealed')} as stored, ${result.alreadySealed} already sealed.`,
    ...leftAlone(result),
    ...temporaries(result.staleTemporaries, tense, mayDelete),
  ];
}

function describeLogs(
  label: string,
  result: ISessionLogMigration | IWorkspaceSessionLogMigration,
  tense: TTense,
  mayDelete: boolean,
): string[] {
  return [
    `${label}: ${count(result.logs, 'log')} (${count(result.lines, 'plain line')}) and ${count(result.payloads, 'payload file')} ${verb(tense, 'to seal', 'sealed')} in place, ${result.alreadySealed} already sealed.`,
    ...leftAlone(result),
    ...result.catchUpFailed.map(
      (failure) =>
        `  ${failure.path}: the catch-up stopped (${failure.reason}) with ${count(failure.unreadBytes, 'byte')} appended to the replaced log unread; those lines are lost.`,
    ),
    ...temporaries(result.staleTemporaries, tense, mayDelete),
  ];
}

const KEPT_PLAIN_REASONS = {
  'over-cap': 'a pre-image would be past the project read limit sealed',
  'snapshot-name': 'a pre-image is kept under a name, or as a link, no sealed checkpoint can hold',
  'hard-linked': 'a file of it has another name, which sealing in place would leave plain',
} as const;

function describeCheckpoints(
  result: IEditCheckpointMigration,
  tense: TTense,
  mayDelete: boolean,
): string[] {
  return [
    `Edit checkpoints: ${count(result.turnsSealed, 'turn')} ${verb(tense, 'to seal', 'sealed')}, ${count(result.turnsFinished, 'unfinished turn')} ${verb(tense, 'to finish', 'finished')} (${count(result.preimagesSealed, 'pre-image')} in all), ${result.alreadySealed} already sealed.`,
    ...result.keptPlain.map(
      (kept) =>
        `  Left plain: ${kept.turn} and ${count(kept.olderTurns, 'older turn')}, since ${KEPT_PLAIN_REASONS[kept.reason]}; sealing an older one would make it read as damaged.`,
    ),
    ...named('Left as they are, since they are damaged', result.damaged),
    ...leftAlone(result),
    ...temporaries(result.staleTemporaries, tense, mayDelete),
  ];
}

/**
 * Whether a converter left nothing for a rerun: nothing changed under it, no catch-up failed,
 * nothing was refused (a refused file keeps what it holds), and no temp file of a crashed write was
 * left in place because a process that could not be checked may still be writing it.
 */
function finished(
  result: {
    readonly changed: readonly string[];
    readonly refused: readonly string[];
    readonly held?: readonly string[];
    readonly catchUpFailed?: readonly unknown[];
    readonly staleTemporaries: number;
  },
  mayDelete: boolean,
): boolean {
  return (
    result.changed.length === 0 &&
    result.refused.length === 0 &&
    (result.held?.length ?? 0) === 0 &&
    (result.catchUpFailed?.length ?? 0) === 0 &&
    (mayDelete || result.staleTemporaries === 0)
  );
}

function sessionRecordsStep(): IMigrationStep {
  const convert = (context: IMigrationContext, apply: boolean): Promise<ISessionRecordMigration> =>
    withSealer(context, (sealer) =>
      migrateNodeSessionStore(
        context.productRuntime.layout.userPaths.sessions,
        converting(context, sealer, apply),
      ),
    );
  const label = (runtime: ICliRuntimeContext): string =>
    `Session records (${runtime.layout.userPaths.sessions})`;
  return {
    title: 'the session records',
    plan: async (context) => ({
      lines: describeRecords(
        label(context.productRuntime),
        await convert(context, false),
        'plan',
        context.mayDeleteLeftovers,
      ),
    }),
    run: async (context) => {
      const result = await convert(context, true);
      const sessions = context.productRuntime.layout.userPaths.sessions;
      const migrated = migratedSessions(context, [
        { target: { kind: 'user', sessions }, where: sessions, records: result.sealedRecords },
      ]);
      return {
        lines: describeRecords(
          label(context.productRuntime),
          result,
          'done',
          context.mayDeleteLeftovers,
        ),
        complete: finished(result, context.mayDeleteLeftovers),
        ...(migrated !== undefined ? { migratedSessions: migrated } : {}),
      };
    },
  };
}

function subagentTranscriptsStep(): IMigrationStep {
  const convert = (context: IMigrationContext, apply: boolean): Promise<ISessionLogMigration> =>
    withSealer(context, (sealer) =>
      migrateSubagentTranscripts(
        context.productRuntime.config.storage.logRoot,
        converting(context, sealer, apply),
      ),
    );
  const label = (runtime: ICliRuntimeContext): string =>
    `Subagent transcripts (${runtime.config.storage.logRoot})`;
  return {
    title: 'the subagent transcripts',
    plan: async (context) => ({
      lines: describeLogs(
        label(context.productRuntime),
        await convert(context, false),
        'plan',
        context.mayDeleteLeftovers,
      ),
    }),
    run: async (context) => {
      const result = await convert(context, true);
      return {
        lines: describeLogs(
          label(context.productRuntime),
          result,
          'done',
          context.mayDeleteLeftovers,
        ),
        complete: finished(result, context.mayDeleteLeftovers),
      };
    },
  };
}

/** What a run did, or would do, with one trusted project's state. */
interface IProjectMigration {
  readonly records: IWorkspaceSessionRecordMigration;
  readonly logs: IWorkspaceSessionLogMigration;
  readonly checkpoints: IEditCheckpointMigration;
  readonly pendingMemory: 'none' | 'found' | 'deleted' | 'kept' | 'refused';
}

function migrateProject(
  project: ITrustedProjectRoot,
  context: IMigrationContext,
  sealer: KeyHolderArtifactSealer,
  apply: boolean,
): IProjectMigration {
  const options = converting(context, sealer, apply);
  const storage = (namespace: 'sessions' | 'session-logs' | 'memory' | 'checkpoints') =>
    getWorkspaceProjectStateStorage(project.authority, namespace);
  const records = migrateWorkspaceProjectSessionRecords(storage('sessions'), options);
  const logs = migrateWorkspaceProjectSessionLogs(storage('session-logs'), options);
  const checkpoints = migrateWorkspaceEditCheckpoints(storage('checkpoints'), options);
  // Candidates an automatic capture drew from the conversation, awaiting a person's approval: there
  // is no sealed form of them, and secure mode does not capture them, so they are deleted.
  const memory = storage('memory');
  const pending = memory
    .listDirectory('', 'find pending memory candidates')
    .find((entry) => entry.name === PENDING_MEMORY_FILE);
  let pendingMemory: IProjectMigration['pendingMemory'] = 'none';
  if (pending !== undefined && pending.kind !== 'file') pendingMemory = 'refused';
  else if (pending !== undefined && !context.mayDeleteLeftovers) pendingMemory = 'kept';
  else if (pending !== undefined && !apply) pendingMemory = 'found';
  else if (pending !== undefined) {
    context.recheckPresence();
    memory.deleteFile(PENDING_MEMORY_FILE, 'delete pending memory candidates');
    pendingMemory = 'deleted';
  }
  return { records, logs, checkpoints, pendingMemory };
}

function describeProject(
  runtime: ICliRuntimeContext,
  project: ITrustedProjectRoot,
  result: IProjectMigration,
  tense: TTense,
  mayDelete: boolean,
): string[] {
  const pendingPath = `${runtime.layout.projectStateDirectories.memory}/${PENDING_MEMORY_FILE}`;
  const pending = {
    none: [],
    found: [`  Pending memory candidates (${pendingPath}): to delete.`],
    deleted: [`  Pending memory candidates (${pendingPath}): deleted.`],
    kept: [
      `  Pending memory candidates (${pendingPath}): left as they are, since some processes could not be checked and may still use them.`,
    ],
    refused: [
      `  Pending memory candidates (${pendingPath}): not a regular file, so not followed; move it aside yourself, then run this again.`,
    ],
  }[result.pendingMemory];
  return [
    `Project ${project.root}:`,
    ...[
      ...describeRecords('Session records', result.records, tense, mayDelete),
      ...describeLogs('Session logs', result.logs, tense, mayDelete),
      ...describeCheckpoints(result.checkpoints, tense, mayDelete),
    ].map((line) => `  ${line}`),
    ...pending,
  ];
}

function listedReason(runtime: ICliRuntimeContext, listed: IListedProjectRoot): string {
  const directory = runtime.layout.projectDirectory;
  switch (listed.reason.kind) {
    case 'not-trusted':
      return `not trusted now (${listed.reason.trustState}); trust it and run this again, or delete its ${directory} yourself`;
    case 'host-cannot-write':
      return `this system cannot write project state safely (only Linux can); run this again on Linux, or delete its ${directory} yourself`;
    case 'unreachable':
      return 'it did not answer in time (an unreachable mount?); run this again once it does';
    case 'below-workspace-root':
      return `an older build kept project state here, below its workspace root, which this does not write; delete its ${directory} yourself`;
    case 'state-is-link':
      return `its ${directory} is a link, which is never followed`;
    case 'trust-store-unreadable':
      return 'the workspace trust store could not be read, so no project counts as trusted; repair it and run this again';
  }
}

function projectsStep(options: IStoreMigrationStepOptions): IMigrationStep {
  const survey = async (
    context: IMigrationContext,
    apply: boolean,
  ): Promise<IMigrationStepOutcome> =>
    withSealer(context, async (sealer) => {
      const runtime = context.productRuntime;
      const roots = await discoverProjectRoots(runtime, sealer, {
        ...(options.platform === undefined ? {} : { platform: options.platform }),
      });
      const tense: TTense = apply ? 'done' : 'plan';
      const lines: string[] = [];
      let complete = true;
      const sealed: IMigratedBatch[] = [];
      for (const project of roots.trusted) {
        try {
          const result = migrateProject(project, context, sealer, apply);
          sealed.push({
            target: { kind: 'project', authority: project.authority },
            where: `the project ${project.root}`,
            records: result.records.sealedRecords,
          });
          lines.push(
            ...describeProject(runtime, project, result, tense, context.mayDeleteLeftovers),
          );
          complete &&=
            finished(result.records, context.mayDeleteLeftovers) &&
            finished(result.logs, context.mayDeleteLeftovers) &&
            finished(result.checkpoints, context.mayDeleteLeftovers) &&
            // Refused is a file to move aside; kept is plaintext a process may still be using.
            result.pendingMemory !== 'refused' &&
            result.pendingMemory !== 'kept';
        } catch (error) {
          if (!(error instanceof WorkspaceAuthorityRequiredError)) throw error;
          complete = false;
          lines.push(
            `Project ${project.root}: stopped, since its state could not be opened safely (${error.message}); what was done there is done, and a rerun goes on.`,
          );
        }
      }
      for (const listed of roots.listed) {
        lines.push(`Project ${listed.root}: left as it is — ${listedReason(runtime, listed)}.`);
      }
      if (roots.trusted.length === 0 && roots.listed.length === 0) {
        lines.push('Projects: none of the recorded projects holds conversation state.');
      }
      if (roots.vanished > 0) {
        lines.push(
          `  ${count(roots.vanished, 'recorded working directory', 'recorded working directories')} ${roots.vanished === 1 ? 'no longer exists' : 'no longer exist'}.`,
        );
      }
      const migrated = migratedSessions(context, sealed);
      return { lines, complete, ...(migrated !== undefined ? { migratedSessions: migrated } : {}) };
    });
  return {
    title: 'the project state',
    plan: async (context) => ({ lines: (await survey(context, false)).lines }),
    run: (context) => survey(context, true),
  };
}

function describeLeftovers(leftovers: ILeftovers, tense: TTense, mayDelete: boolean): string[] {
  const lines = !mayDelete
    ? [
        'Leftover files: left as they are, since some processes could not be checked and may still use them.',
      ]
    : [
        `Leftover files ${verb(tense, 'to remove', 'removed')}: ${count(leftovers.handoffFiles, 'kept-aside hand-off file')}, ${count(leftovers.editorDirectories, 'old /editor directory', 'old /editor directories')} (in ${leftovers.temporaryDirectory}), ${count(leftovers.deadProcessDirectories, 'scratch directory', 'scratch directories')} of processes that are gone.`,
      ];
  if (mayDelete && leftovers.recentEditorDirectories > 0) {
    lines.push(
      `  ${count(leftovers.recentEditorDirectories, 'old /editor directory', 'old /editor directories')} used within the last day left for a later run.`,
    );
  }
  lines.push(
    ...named(
      "SDK spill directories, which may be another program's, left as they are",
      leftovers.sdkSpillDirectories,
    ),
    ...named(
      "Not followed (links, entries that are not this account's, or that could not be read)",
      leftovers.refused,
    ),
  );
  return lines;
}

function leftoversStep(options: IStoreMigrationStepOptions): IMigrationStep {
  const survey = (
    context: IMigrationContext,
    apply: boolean,
  ): { readonly lines: string[]; readonly leftInPlace: boolean } => {
    const leftovers = sweepMigrationLeftovers(context.productRuntime, {
      apply: apply && context.mayDeleteLeftovers,
      ...(options.temporaryDirectory === undefined
        ? {}
        : { temporaryDirectory: options.temporaryDirectory }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return {
      lines: describeLeftovers(leftovers, apply ? 'done' : 'plan', context.mayDeleteLeftovers),
      // Found and not removed because a process that could not be checked may still use them.
      leftInPlace:
        !context.mayDeleteLeftovers &&
        leftovers.handoffFiles + leftovers.editorDirectories + leftovers.deadProcessDirectories > 0,
    };
  };
  return {
    title: 'the leftover files',
    plan: (context) => ({ lines: survey(context, false).lines }),
    run: async (context) => {
      context.recheckPresence();
      const { lines, leftInPlace } = survey(context, true);
      return { lines, complete: !leftInPlace };
    },
  };
}

/** The store steps of a migration, in the order they run. */
export function createStoreMigrationSteps(
  options: IStoreMigrationStepOptions = {},
): readonly IMigrationStep[] {
  return [
    sessionRecordsStep(),
    subagentTranscriptsStep(),
    projectsStep(options),
    leftoversStep(options),
  ];
}
