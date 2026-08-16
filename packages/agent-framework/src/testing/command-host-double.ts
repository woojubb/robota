import type { IEditCheckpointRestoreResult } from '../checkpoints/edit-checkpoint-types.js';
import type { ICommandHostAdapters } from '../command-api/host-adapters.js';
import type {
  IAgentJobHostContext,
  ICommandHostContext,
  ICommandSessionRuntime,
} from '../command-api/host-context.js';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  ISubagentJobState,
} from '@robota-sdk/agent-interface-transport';

/**
 * ARCH-029: a conformant, cast-free `ICommandHostContext` double.
 *
 * ## Why this exists
 *
 * 21 test fixtures reach the command host through `as unknown as ICommandHostContext`, and another
 * set reaches it through typed literals the cast ratchet cannot see. They are not carelessness —
 * until now there was nothing honest to reach for. A 46-member contract with 32 optional members
 * means a partial object satisfies the compiler while proving nothing about the real host.
 *
 * ARCH-012 solved the identical problem one layer over, and the mechanism that actually killed its
 * 37 casts was **a conformant double placed where every consumer can reach it** — not a runtime
 * capability host. This is that double for the command axis. It lives beside the contract it doubles
 * (`agent-framework` owns `ICommandHostContext`), behind the already-exported `./testing` subpath, so
 * all three consumer packages reach it with no new dependency edge.
 *
 * ## The property that matters
 *
 * The returned object is typed `ICommandHostContext` with **no assertion**. The compiler refuses it
 * the moment the contract gains a member this file does not answer. A double built through a cast —
 * or through a typed factory that lies — would satisfy the cast ratchet and guarantee nothing, which
 * is the failure mode `scan-contract-cast-ratchet.mjs` documents in its own header.
 *
 * ## What the defaults mean
 *
 * Every default answers *"this host has nothing of that kind"* — empty lists, `undefined` states,
 * resolved promises. That is deliberate: a test that needs a capability to be PRESENT must say so
 * through `overrides`, so the fixture states its own preconditions instead of inheriting them.
 */

/**
 * A restore that touched nothing. Named rather than inlined twice so the two checkpoint members
 * cannot drift apart, and so a reader sees it is "nothing happened", not "it failed".
 */
const EMPTY_RESTORE_RESULT: IEditCheckpointRestoreResult = {
  target: {
    id: 'test-checkpoint',
    sessionId: 'test-command-host',
    sequence: 0,
    prompt: '',
    createdAt: '1970-01-01T00:00:00.000Z',
    fileCount: 0,
  },
  restoredCheckpointCount: 0,
  restoredFileCount: 0,
  removedCheckpointCount: 0,
};

/** One expression of "no context used yet", read by both the host and its session runtime. */
const EMPTY_CONTEXT_STATE = {
  maxTokens: 0,
  usedTokens: 0,
  usedPercentage: 0,
  remainingPercentage: 100,
} as const;

/** No adapter is injected by default — a test that needs one states it through `overrides`. */
const EMPTY_ADAPTERS: ICommandHostAdapters = {};

/**
 * The root every default cwd hangs off. Deliberately NOT under `/tmp`: SEC-003's floor treats a
 * hardcoded shared-temp literal as a CWE-377 taint source, and it is right to — the cwd is handed to the
 * production code under test, which may write through it. This path does not exist, so a test that
 * actually writes fails loudly instead of succeeding quietly inside a world-writable directory.
 */
const FAKE_ROOT = '/robota-test-command-host';

/** Counts doubles so each gets a distinguishable cwd when a test does not name one. */
let doublesCreated = 0;

function createSessionRuntimeDouble(
  overrides?: Partial<ICommandSessionRuntime>,
): ICommandSessionRuntime {
  // No cast here either. An earlier revision of this file wrote `as ICommandSessionRuntime` over four
  // members of an 18-member contract — the exact defect this double exists to remove, inside the file
  // that removes it. A double built through a helper that casts satisfies the ratchet and guarantees
  // nothing; `scan-contract-cast-ratchet.mjs` says so in its own header.
  const base: ICommandSessionRuntime = {
    getSessionId: () => `test-command-host-${doublesCreated}`,
    getHistory: () => [],
    getFullHistory: () => [],
    getMessageCount: () => 0,
    clearHistory: () => {},
    compact: () => Promise.resolve(),
    getContextState: () => EMPTY_CONTEXT_STATE,
    getPermissionMode: () => 'default',
    setPermissionMode: () => {},
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => false,
  };
  return { ...base, ...overrides };
}

export interface ICreateTestCommandHostOptions {
  /** Overrides applied last, so a test can state exactly the capability it exercises. */
  readonly overrides?: Partial<ICommandHostContext>;
  /** Convenience for the common case of shaping only the session runtime. */
  readonly session?: Partial<ICommandSessionRuntime>;
  /** The working directory every path-scoped command reads. */
  readonly cwd?: string;
}

export function createTestCommandHost(
  options: ICreateTestCommandHostOptions = {},
): ICommandHostContext {
  doublesCreated += 1;
  const cwd = options.cwd ?? `${FAKE_ROOT}-${doublesCreated}`;
  const sessionRuntime = createSessionRuntimeDouble(options.session);

  // No assertion anywhere in this object. The compiler refuses it the moment the contract gains a
  // member this file does not answer — which is the entire property the 21 hand-rolled partials lack.
  const base: ICommandHostContext = {
    getSession: () => sessionRuntime,
    getCwd: () => cwd,
    getContextState: () => EMPTY_CONTEXT_STATE,
    getAutoCompactThreshold: () => false,
    compactContext: () => Promise.resolve(),
    listCommands: () => [],
    listSkills: () => [],
    // `null` is 'this host has no such skill command' — distinct from a command that ran and failed.
    executeSkillCommandByName: () => Promise.resolve(null),
    listContextReferences: () => [],
    // Each answers "nothing was there": no reference added, none removed, none evicted.
    addContextReference: () => Promise.resolve({ evicted: [], diagnostics: [] }),
    removeContextReference: () => ({}),
    clearContextReferences: () => ({ removed: [] }),
    listEditCheckpoints: () => [],
    inspectEditCheckpoint: () => ({
      target: EMPTY_RESTORE_RESULT.target,
      capturedFiles: [],
      restoreToCheckpoint: { checkpointIds: [], fileCount: 0 },
      rollbackThroughCheckpoint: { checkpointIds: [], fileCount: 0 },
    }),
    restoreEditCheckpoint: () => Promise.resolve(EMPTY_RESTORE_RESULT),
    rollbackEditCheckpoint: () => Promise.resolve(EMPTY_RESTORE_RESULT),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => {},
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: (taskId: string) => Promise.resolve({ taskId, lines: [] }),
    cancelBackgroundTask: () => Promise.resolve(),
    closeBackgroundTask: () => Promise.resolve(),
    getCommandHostAdapters: () => EMPTY_ADAPTERS,
    canHandoffTerminal: () => false,
  };

  return { ...base, ...options.overrides };
}

/**
 * ARCH-029: the same double, for the capability `ICommandHostContext` reaches through
 * `getAgentJobCapability()`.
 *
 * `IAgentJobHostContext` declares 15 members and **none** of them optional — so it is the more honest
 * of the two contracts, and satisfying it without a cast means answering all fifteen. That is exactly
 * why fixtures cast it: there was nothing to reach for. Migrating a host cast into a job cast would
 * have been half the work, which is why this exists rather than a second `as unknown as`.
 */
/**
 * The three states this contract returns, each meaning "nothing ran". Named rather than inlined so a
 * reader sees they are placeholders, and so the five members returning them cannot drift apart.
 */
const NEVER = '1970-01-01T00:00:00.000Z';

const EMPTY_SUBAGENT_JOB: ISubagentJobState = {
  id: 'test-agent-job',
  type: 'general-purpose',
  label: 'test',
  parentSessionId: 'test-command-host',
  status: 'running',
  mode: 'background',
  depth: 1,
  cwd: FAKE_ROOT,
  promptPreview: '',
  updatedAt: NEVER,
};

const EMPTY_JOB_GROUP: IBackgroundJobGroupState = {
  id: 'test-group',
  parentSessionId: 'test-command-host',
  waitPolicy: 'wait_all',
  taskIds: [],
  status: 'running',
  createdAt: NEVER,
  updatedAt: NEVER,
  results: [],
};

const EMPTY_BACKGROUND_TASK: IBackgroundTaskState = {
  id: 'test-background-task',
  kind: 'agent',
  label: 'test',
  status: 'running',
  mode: 'background',
  parentSessionId: 'test-command-host',
  depth: 1,
  cwd: FAKE_ROOT,
  updatedAt: NEVER,
  unread: false,
};

export function createTestAgentJobHost(
  overrides?: Partial<IAgentJobHostContext>,
): IAgentJobHostContext {
  const base: IAgentJobHostContext = {
    listAgentDefinitions: () => [],
    listAgentJobs: () => [],
    spawnAgentJob: () => Promise.resolve(EMPTY_SUBAGENT_JOB),
    sendAgentJob: () => Promise.resolve(),
    cancelAgentJob: () => Promise.resolve(),
    closeAgentJob: () => Promise.resolve(),
    createBackgroundJobGroup: () => EMPTY_JOB_GROUP,
    waitBackgroundJobGroup: () => Promise.resolve(EMPTY_JOB_GROUP),
    spawnScheduledWake: () => Promise.resolve(EMPTY_BACKGROUND_TASK),
    listSchedules: () => [],
    pauseSchedule: () => Promise.resolve(),
    resumeSchedule: () => Promise.resolve(),
    editSchedule: () => Promise.resolve(),
    spawnMonitorWake: () => Promise.resolve(EMPTY_BACKGROUND_TASK),
    readBackgroundTaskLog: (taskId: string) => Promise.resolve({ taskId, lines: [] }),
  };
  return { ...base, ...overrides };
}
