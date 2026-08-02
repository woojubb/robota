import type { IInteractiveSession } from './session-contracts.js';

/**
 * The conformant `IInteractiveSession` double, next to the contract it implements. ARCH-012.
 *
 * WHY IT LIVES HERE. A double for this contract already existed, published, and documented — in
 * `@robota-sdk/agent-framework`. It had **zero consumers**, and the reason is the dependency
 * direction: every transport package sits BELOW `agent-framework`, so none of them can import it.
 * The 41 hand-rolled `as unknown as IInteractiveSession` partials across 29 files were not an
 * oversight; they were the only thing those packages could reach.
 *
 * Placed with the contract, it is importable by everything that consumes the contract. The framework
 * re-exports this one rather than keeping a second implementation — two doubles for one contract can
 * disagree, which is the defect a level down.
 *
 * WHAT MAKES IT CONFORMANT: it is typed as `IInteractiveSession` with no cast, so the compiler
 * refuses it the moment the contract gains a member. That is the property the private partials do not
 * have — each was checked against nothing, so the suites built on them proved things no shipped code
 * guarantees.
 */
const EMPTY_CONTEXT_STATE = {
  usedTokens: 0,
  maxTokens: 200000,
  usedPercentage: 0,
  remainingPercentage: 100,
};

const EMPTY_EXECUTION_WORKSPACE = {
  sessionId: 'test-session-id',
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
  parentSessionId: 'test-session-id',
  waitPolicy: 'wait_all' as const,
  taskIds: [],
  status: 'completed' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  results: [],
};

/** Creates a stub IInteractiveSession for use in tests. All methods return sensible defaults.
 *  Pass overrides to spy on or replace specific methods. */
export function createTestInteractiveSession(
  overrides?: Partial<IInteractiveSession>,
): IInteractiveSession {
  const base: IInteractiveSession = {
    // ARCH-012: required, not optional. A double that omitted them let a consumer's
    // `getActiveDriverId?.()` resolve to `undefined` and read as "no active driver" — the ambiguity
    // the contract change removes. `null` here means nobody is driving, and only that.
    isInitialized: true,
    getPendingCount: () => 0,
    getActiveDriverId: () => null,
    submit: () => Promise.resolve(),
    abort: () => {},
    cancelQueue: () => {},
    shutdown: () => Promise.resolve(),
    isExecuting: () => false,
    getPendingPrompt: () => null,
    getMessages: () => [],
    getContextState: () => ({ ...EMPTY_CONTEXT_STATE }),
    getSession: () => ({
      getSessionId: () => 'test-session-id',
      // SELFHOST-004: the span collector subscribes to the session bus each turn.
      getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
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
    createBackgroundJobGroup: () => ({ ...EMPTY_BACKGROUND_GROUP }),
    waitBackgroundJobGroup: () => Promise.resolve({ ...EMPTY_BACKGROUND_GROUP }),
    getExecutionWorkspaceSnapshot: () => ({ ...EMPTY_EXECUTION_WORKSPACE }),
    listAgentDefinitions: () => [],
    listAgentJobs: () => [],
    spawnAgentJob: () =>
      Promise.resolve({
        id: 'agent_1',
        type: 'general-purpose',
        label: 'general-purpose',
        parentSessionId: 'test-session-id',
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
  return base;
}
