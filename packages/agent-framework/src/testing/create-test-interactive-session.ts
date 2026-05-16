import type { IInteractiveSession } from '../interactive/i-interactive-session.js';

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
    submit: () => Promise.resolve(),
    abort: () => {},
    cancelQueue: () => {},
    shutdown: () => Promise.resolve(),
    isExecuting: () => false,
    getPendingPrompt: () => null,
    getMessages: () => [],
    getContextState: () => ({ ...EMPTY_CONTEXT_STATE }),
    getSession: () => ({ getSessionId: () => 'test-session-id' }),
    getCwd: () => '/workspace',
    executeCommand: () => Promise.resolve(null),
    listCommands: () => [],
    on: () => {},
    off: () => {},
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
    ...overrides,
  };
  return base;
}
