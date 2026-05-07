import { describe, expect, it, vi } from 'vitest';
import type {
  ICommandHostContext,
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
  ICommandSessionRuntime,
  TAutoCompactThresholdSource,
} from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createContextCommandModule } from '../context-command-module.js';

type TContextWindowState = ReturnType<ICommandHostContext['getContextState']>;
type TPermissionMode = ReturnType<ICommandSessionRuntime['getPermissionMode']>;

const CONTEXT_STATE: TContextWindowState = {
  usedTokens: 5000,
  maxTokens: 200000,
  usedPercentage: 2.5,
  remainingPercentage: 97.5,
};

const MANUAL_REFERENCE: IContextReferenceItem = {
  id: 'manual:AGENTS.md',
  sourcePath: '/workspace/AGENTS.md',
  relativePath: 'AGENTS.md',
  originalReference: '@AGENTS.md',
  loadType: 'manual',
  status: 'active',
  byteLength: 42,
  loadedAt: '2026-05-05T00:00:00.000Z',
  lastUsedAt: '2026-05-05T00:00:00.000Z',
};

const PROMPT_REFERENCE: IContextReferenceItem = {
  id: 'prompt-reference:packages/agent-sdk/docs/SPEC.md',
  sourcePath: '/workspace/packages/agent-sdk/docs/SPEC.md',
  relativePath: 'packages/agent-sdk/docs/SPEC.md',
  originalReference: '@packages/agent-sdk/docs/SPEC.md',
  loadType: 'prompt-reference',
  status: 'observed',
  byteLength: 200,
  loadedAt: '2026-05-05T00:00:01.000Z',
  lastUsedAt: '2026-05-05T00:00:01.000Z',
};

function createRuntime(state: { threshold: number | false }): ICommandSessionRuntime {
  let mode: TPermissionMode = 'default';
  return {
    clearHistory: vi.fn(),
    compact: vi.fn().mockResolvedValue(undefined),
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode: (nextMode) => {
      mode = nextMode;
    },
    getSessionId: () => 'session_1',
    getMessageCount: () => 1,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => state.threshold,
    setAutoCompactThreshold: (threshold) => {
      state.threshold = threshold;
    },
  };
}

function createCommandHostContext(threshold: number | false = 0.835): ICommandHostContext & {
  settings: Record<string, number | false>;
  source: TAutoCompactThresholdSource;
  references: IContextReferenceItem[];
} {
  const state = {
    threshold,
    source: 'settings' as TAutoCompactThresholdSource,
    settings: {} as Record<string, number | false>,
    references: [] as IContextReferenceItem[],
  };
  const runtime = createRuntime(state);
  return {
    get settings() {
      return state.settings;
    },
    get source() {
      return state.source;
    },
    get references() {
      return state.references;
    },
    getSession: () => runtime,
    getContextState: () => CONTEXT_STATE,
    getAutoCompactThreshold: () => state.threshold,
    getAutoCompactThresholdSource: () => state.source,
    setAutoCompactThreshold: (nextThreshold, source = 'session') => {
      state.threshold = nextThreshold;
      state.source = source;
    },
    getCommandHostAdapters: () => ({
      settings: {
        read: () => state.settings,
        write: (settings) => {
          const value = settings.autoCompactThreshold;
          state.settings =
            typeof value === 'number' || value === false ? { autoCompactThreshold: value } : {};
        },
      },
    }),
    compactContext: vi.fn(),
    listContextReferences: () => [...state.references],
    addContextReference: async (path): Promise<IContextReferenceAddResult> => {
      const reference = {
        ...MANUAL_REFERENCE,
        relativePath: path,
        sourcePath: `/workspace/${path}`,
        originalReference: `@${path}`,
      };
      state.references = [...state.references, reference];
      return { reference, evicted: [], diagnostics: [] };
    },
    removeContextReference: (path): IContextReferenceRemoveResult => {
      const removed = state.references.find((reference) => reference.relativePath === path);
      state.references = state.references.filter((reference) => reference.relativePath !== path);
      return removed ? { removed } : {};
    },
    clearContextReferences: (): IContextReferenceClearResult => {
      const removed = [...state.references];
      state.references = [];
      return { removed };
    },
    getCwd: () => '/workspace',
    listCommands: () => [],
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: vi.fn(),
    rollbackEditCheckpoint: vi.fn(),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: vi.fn(),
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: vi.fn().mockResolvedValue({ taskId: 'task_1', lines: [] }),
    cancelBackgroundTask: vi.fn(),
    closeBackgroundTask: vi.fn(),
  };
}

function createExecutor(): SystemCommandExecutor {
  return new SystemCommandExecutor([...(createContextCommandModule().systemCommands ?? [])]);
}

describe('createContextCommandModule', () => {
  it('provides context metadata and an executable command', () => {
    const module = createContextCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-context');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'context',
        description: 'Context window info, reference inventory, and auto-compact controls',
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'context',
        modelInvocable: false,
      }),
    );
  });

  it('formats context usage and enabled auto compact policy', async () => {
    const result = await createExecutor().execute('context', createCommandHostContext(0.75), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Context: 5,000 / 200,000 tokens (3%)');
    expect(result?.message).toContain('Auto compact: 75% (settings)');
    expect(result?.message).toContain('References: 0 active, 0 observed');
    expect(result?.data).toEqual({
      usedTokens: 5000,
      maxTokens: 200000,
      percentage: 2.5,
      autoCompactThreshold: 0.75,
      autoCompactThresholdSource: 'settings',
      references: [],
    });
  });

  it('lists active and observed context references', async () => {
    const context = createCommandHostContext();
    context.references.push(MANUAL_REFERENCE, PROMPT_REFERENCE);

    const result = await createExecutor().execute('context', context, 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('AGENTS.md [manual, active] 42 B');
    expect(result?.message).toContain(
      'packages/agent-sdk/docs/SPEC.md [prompt-reference, observed] 200 B',
    );
    expect(result?.data?.references).toEqual([MANUAL_REFERENCE, PROMPT_REFERENCE]);
  });

  it('adds manual context references through the SDK command API', async () => {
    const context = createCommandHostContext();

    const result = await createExecutor().execute('context', context, 'add AGENTS.md');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Context reference added: AGENTS.md [manual, active] 42 B.');
    expect(context.references[0]?.relativePath).toBe('AGENTS.md');
  });

  it('removes context references through the SDK command API', async () => {
    const context = createCommandHostContext();
    context.references.push(MANUAL_REFERENCE);

    const result = await createExecutor().execute('context', context, 'remove AGENTS.md');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Context reference removed: AGENTS.md [manual, active] 42 B.');
    expect(context.references).toEqual([]);
  });

  it('clears context references through the SDK command API', async () => {
    const context = createCommandHostContext();
    context.references.push(MANUAL_REFERENCE, PROMPT_REFERENCE);

    const result = await createExecutor().execute('context', context, 'clear');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Context references cleared: 2 removed.');
    expect(context.references).toEqual([]);
  });

  it('formats disabled auto compact policy', async () => {
    const result = await createExecutor().execute('context', createCommandHostContext(false), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Auto compact: disabled');
    expect(result?.data?.autoCompactThreshold).toBe(false);
  });

  it('sets auto compact threshold and persists the setting', async () => {
    const context = createCommandHostContext();
    const result = await createExecutor().execute('context', context, 'auto 85%');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Auto compact threshold set to 85% (settings).');
    expect(context.settings.autoCompactThreshold).toBe(0.85);
    expect(context.source).toBe('settings');
    expect(context.getAutoCompactThreshold()).toBe(0.85);
  });

  it('disables auto compact and persists false', async () => {
    const context = createCommandHostContext();
    const result = await createExecutor().execute('context', context, 'auto off');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Auto compact disabled (settings).');
    expect(context.settings.autoCompactThreshold).toBe(false);
    expect(context.getAutoCompactThreshold()).toBe(false);
  });

  it('enables auto compact at the documented default', async () => {
    const context = createCommandHostContext(false);
    const result = await createExecutor().execute('context', context, 'auto on');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Auto compact enabled at 84% (settings).');
    expect(context.settings.autoCompactThreshold).toBe(0.835);
    expect(context.getAutoCompactThreshold()).toBe(0.835);
  });

  it('resets auto compact to the documented default and removes persisted override', async () => {
    const context = createCommandHostContext(0.5);
    await createExecutor().execute('context', context, 'auto 70%');

    const result = await createExecutor().execute('context', context, 'auto reset');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Auto compact reset to default: 84% (settings).');
    expect(context.settings).toEqual({});
    expect(context.source).toBe('default');
    expect(context.getAutoCompactThreshold()).toBe(0.835);
  });

  it('rejects invalid auto compact thresholds', async () => {
    const result = await createExecutor().execute(
      'context',
      createCommandHostContext(),
      'auto 150%',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('greater than 0% and at most 100%');
  });
});
