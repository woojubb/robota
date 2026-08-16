import type { IInteractiveSession } from '../session-contracts.js';
export { createSessionCapabilityHost as createTestSessionCapabilityHost } from './session-capability-host.js';
export { runTransportLifecycleConformance } from './transport-lifecycle-conformance.js';
export type { ITransportLifecycleConformanceFixture } from './transport-lifecycle-conformance.js';

const EMPTY_CONTEXT_STATE = {
  usedTokens: 0,
  maxTokens: 200000,
  usedPercentage: 0,
  remainingPercentage: 100,
};

// `sessionId` here is a PLACEHOLDER. Every read of these shapes goes through the factory below,
// which stamps the double's own id over it — see the note on `sessionId` there. Left as a literal
// so the shape stays a plain constant; nothing outside the factory should read it.
const EMPTY_EXECUTION_WORKSPACE = {
  sessionId: 'test-session-placeholder',
  updatedAt: new Date().toISOString(),
  entries: [] as [],
};

const EMPTY_GOAL_STATE = {
  id: 'test-goal',
  objective: 'test goal',
  status: 'active' as const,
  iterations: 0,
  maxIterations: 25,
  startedAt: new Date().toISOString(),
  progress: [] as [],
};

const EMPTY_BACKGROUND_GROUP = {
  id: '',
  parentSessionId: 'test-session-placeholder',
  waitPolicy: 'wait_all' as const,
  taskIds: [],
  status: 'completed' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  results: [],
};

/**
 * The conformant `IInteractiveSession` double, next to the contract it implements. ARCH-012.
 *
 * WHY IT LIVES HERE. A double for this contract already existed, published, and documented — in
 * `@robota-sdk/agent-framework`. It had **zero consumers**, and the reason is the dependency
 * direction: every transport package sits BELOW `agent-framework`, so none of them can import it.
 * The 41 hand-rolled `as unknown as IInteractiveSession` partials across 29 files were not an
 * oversight; they were the only thing those packages could reach.
 *
 * Placed with the contract, it is importable by everything that consumes the contract — but behind
 * the `./testing` SUBPATH, never the main entry. `code-quality.md` is explicit about that, and the
 * reason is concrete: the main entry is the shipped runtime bundle of a published package, and a test
 * fixture has no business in it. `@robota-sdk/agent-core/testing`'s scripted-provider is the
 * precedent. The first draft of this move put it on the main entry and review measured the double in
 * `dist/node/index.js`.
 *
 * WHAT MAKES IT CONFORMANT: it is typed as `IInteractiveSession` with no cast, so the compiler
 * refuses it the moment the contract gains a member. That is the property the private partials do not
 * have — each was checked against nothing, so the suites built on them proved things no shipped code
 * guarantees.
 */
/** Counts doubles so each gets its own session id. See `getSessionId` below. */
let doublesCreated = 0;

export function createTestInteractiveSession(
  overrides?: Partial<IInteractiveSession>,
): IInteractiveSession {
  const fallbackId = `test-session-${(doublesCreated += 1)}`;
  let submissionsAccepted = 0;
  /**
   * The id EVERY surface of this double names — including when a caller overrides `getSession`.
   *
   * `parentSessionId`/workspace `sessionId` used to close over the counter value directly, so an
   * overridden `getSession().getSessionId()` and the other surfaces disagreed about who this
   * session is — the exact cross-surface id collision the counter was added to remove, reopened by
   * the override path. Review found it before a suite did. Resolved LAZILY through the assembled
   * object, falling back to the counter when the override cannot answer (throws, or returns an
   * empty id — both are shapes tests deliberately build).
   */
  const sessionId = (): string => {
    try {
      const id = assembled.getSession().getSessionId();
      return typeof id === 'string' && id !== '' ? id : fallbackId;
    } catch {
      // allow-fallback: a double whose getSession deliberately throws still needs a name for its OTHER surfaces
      return fallbackId;
    }
  };
  const base: IInteractiveSession = {
    // ARCH-012: required, not optional. A double that omitted them let a consumer's
    // `getActiveDriverId?.()` resolve to `undefined` and read as "no active driver" — the ambiguity
    // the contract change removes. `null` here means nobody is driving, and only that.
    isInitialized: true,
    getPendingCount: () => 0,
    getActiveDriverId: () => null,
    // RUNTIME-003: a double must hand back a handle that SETTLES, because that is the promise the
    // contract makes and a double that never settled would let a suite pass while the consumer it
    // stands in for hangs. The default turn ends at once with an empty result.
    submit: () =>
      Promise.resolve({
        turnId: `${sessionId()}-turn-${(submissionsAccepted += 1)}`,
        completed: Promise.resolve({
          response: '',
          history: [],
          toolSummaries: [],
          contextState: { ...EMPTY_CONTEXT_STATE },
        }),
      }),
    abort: () => {},
    cancelQueue: () => {},
    shutdown: () => Promise.resolve(),
    isExecuting: () => false,
    getPendingPrompt: () => null,
    getMessages: () => [],
    getContextState: () => ({ ...EMPTY_CONTEXT_STATE }),
    getSession: () => ({
      // DISTINCT per double, because a session id IDENTIFIES a session. A fixed literal made every
      // instance report the same identity, so two doubles standing in for two different sessions
      // were indistinguishable to any consumer that keys by id — and a fixture that cannot
      // represent two sessions cannot test anything about two sessions. Found when
      // `agent-transport-http` started keying its concurrent-turn claim by id and the multi-tenant
      // case went red for the fixture's reason rather than the code's.
      //
      // A counter, not a random: the value stays stable within one double and reproducible across
      // runs, so a failure message names the same session twice.
      getSessionId: () => fallbackId,
    }),
    getCwd: () => '/workspace',
    executeCommand: () => Promise.resolve(null),
    listCommands: () => [],
    on: () => {},
    off: () => {},
    resolvePermission: () => {},
    resolveAsk: () => {},
    listBackgroundTasks: () => [],
    getBackgroundTask: () => undefined,
    cancelBackgroundTask: () => Promise.resolve(),
    closeBackgroundTask: () => Promise.resolve(),
    sendBackgroundTask: () => Promise.resolve(),
    readBackgroundTaskLog: () => Promise.resolve({ taskId: '', lines: [] }),
    listBackgroundJobGroups: () => [],
    getBackgroundJobGroup: () => undefined,
    // EVERY surface that names this session names the SAME id, and review is why. Making
    // `getSessionId()` per-double left three others on a shared literal — so a consumer that
    // distinguishes two doubles by `parentSessionId` or by the workspace snapshot's `sessionId`
    // still saw one session where there were two, which is the exact collision the change was
    // meant to remove, one field over.
    createBackgroundJobGroup: () => ({ ...EMPTY_BACKGROUND_GROUP, parentSessionId: sessionId() }),
    waitBackgroundJobGroup: () =>
      Promise.resolve({ ...EMPTY_BACKGROUND_GROUP, parentSessionId: sessionId() }),
    getExecutionWorkspaceSnapshot: () => ({ ...EMPTY_EXECUTION_WORKSPACE, sessionId: sessionId() }),
    listAgentDefinitions: () => [],
    listAgentJobs: () => [],
    spawnAgentJob: () =>
      Promise.resolve({
        id: 'agent_1',
        type: 'general-purpose',
        label: 'general-purpose',
        parentSessionId: sessionId(),
        status: 'running' as const,
        mode: 'background' as const,
        depth: 1,
        cwd: '/workspace',
        promptPreview: '',
        updatedAt: new Date().toISOString(),
      }),
    sendAgentJob: () => Promise.resolve(),
    cancelAgentJob: () => Promise.resolve(),
    closeAgentJob: () => Promise.resolve(),
    setGoal: () => Promise.resolve({ ...EMPTY_GOAL_STATE }),
    getGoalState: () => null,
    cancelGoal: () => null,
    ...overrides,
  };
  const assembled = base;
  return assembled;
}
