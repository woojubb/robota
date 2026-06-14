import { describe, expect, it, vi } from 'vitest';
import { listPresets } from '@robota-sdk/agent-preset';
import type { ICommandHostContext, ICommandSessionRuntime } from '@robota-sdk/agent-framework';
import { createPresetCommandModule, executePresetCommand } from '../index.js';

function createSessionRuntime(overrides?: Partial<ICommandSessionRuntime>): ICommandSessionRuntime {
  return {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getPermissionMode: () => 'default',
    setPermissionMode: () => undefined,
    getSessionId: () => 'session_1',
    getMessageCount: () => 0,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => false,
    getFullHistory: () => [],
    getHistory: () => [],
    ...overrides,
  };
}

function createCommandHostContext(
  runtime: ICommandSessionRuntime,
  overrides?: Partial<ICommandHostContext>,
): ICommandHostContext {
  return {
    getSession: () => runtime,
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getAutoCompactThreshold: () => 0.8,
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => ({
      target: {
        id: 'checkpoint_1',
        sessionId: 'session_1',
        sequence: 1,
        prompt: 'edit',
        createdAt: '2026-05-03T00:00:00.000Z',
        fileCount: 0,
      },
      restoredCheckpointCount: 1,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    rollbackEditCheckpoint: async () => ({
      target: {
        id: 'checkpoint_1',
        sessionId: 'session_1',
        sequence: 1,
        prompt: 'edit',
        createdAt: '2026-05-03T00:00:00.000Z',
        fileCount: 0,
      },
      restoredCheckpointCount: 1,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
    ...overrides,
  };
}

describe('preset command module', () => {
  it('exposes a single preset system command (structure)', () => {
    const module = createPresetCommandModule();
    expect(module.systemCommands?.map((command) => command.name)).toContain('preset');
  });

  it('TC-01: lists every preset and marks the active one', () => {
    const runtime = createSessionRuntime({ getActivePresetId: () => 'autonomous-builder' });
    const context = createCommandHostContext(runtime);

    const result = executePresetCommand(context, '');

    expect(result.success).toBe(true);
    for (const preset of listPresets()) {
      expect(result.message).toContain(preset.id);
    }
    // The active preset is marked with the `* ` prefix.
    expect(result.message).toContain('* autonomous-builder');
    expect(result.message).not.toContain('* default');
    expect(result.data?.active).toBe('autonomous-builder');
  });

  it('TC-02: switches to a valid preset and drives the live re-apply seams', () => {
    const setActivePresetId = vi.fn();
    const setPermissionMode = vi.fn();
    const applyModelOptions = vi.fn();
    const runtime = createSessionRuntime({
      setActivePresetId,
      setPermissionMode,
      applyModelOptions,
    });
    const context = createCommandHostContext(runtime);

    const result = executePresetCommand(context, 'careful-reviewer');

    expect(result.success).toBe(true);
    expect(result.message).toBe('Switched to preset: careful-reviewer');
    expect(result.data?.preset).toBe('careful-reviewer');
    expect(setActivePresetId).toHaveBeenCalledWith('careful-reviewer');
    // careful-reviewer resolves autonomy ask-first → default permission posture (PRESET-012)
    // and effort high → applyModelOptions (PRESET-013).
    expect(setPermissionMode).toHaveBeenCalledWith('default');
    expect(applyModelOptions).toHaveBeenCalledWith(expect.objectContaining({ effort: 'high' }));
  });

  it('TC-04: rejects an unknown preset id without switching', () => {
    const setActivePresetId = vi.fn();
    const runtime = createSessionRuntime({ setActivePresetId });
    const context = createCommandHostContext(runtime);

    const result = executePresetCommand(context, '__nope__');

    expect(result.success).toBe(false);
    for (const preset of listPresets()) {
      expect(result.message).toContain(preset.id);
    }
    expect(setActivePresetId).not.toHaveBeenCalled();
  });
});
