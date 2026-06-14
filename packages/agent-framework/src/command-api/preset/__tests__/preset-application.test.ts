import { describe, expect, it, vi } from 'vitest';

import { applyPresetToSession } from '../preset-application.js';

import type { ICommandHostContext, ICommandSessionRuntime } from '../../host-context.js';
import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';

const CONTEXT_STATE: IContextWindowState = {
  maxTokens: 100,
  usedTokens: 10,
  usedPercentage: 10,
  remainingPercentage: 90,
};

interface IRuntimeSpies {
  setPermissionMode: ReturnType<typeof vi.fn>;
  setActivePresetId?: ReturnType<typeof vi.fn>;
  applyModelOptions?: ReturnType<typeof vi.fn>;
  applyPersona?: ReturnType<typeof vi.fn>;
  applyCommandModuleSelection?: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal ICommandHostContext whose runtime records permission-mode / active-preset /
 * model-option writes. `includeActivePreset: false` omits the optional `setActivePresetId` to
 * exercise the defensive optional-chaining path (PRESET-012 TC-05). `includeApplyModelOptions:
 * false` omits the optional `applyModelOptions` to exercise the PRESET-013 optional path (TC-06).
 * `includeApplyPersona: false` omits the optional `applyPersona` to exercise the PRESET-014
 * optional path (TC-05). `includeApplyCommandModuleSelection: false` omits the optional
 * `applyCommandModuleSelection` to exercise the PRESET-015 optional path (TC-06).
 */
function createContext(
  includeActivePreset = true,
  includeApplyModelOptions = true,
  includeApplyPersona = true,
  includeApplyCommandModuleSelection = true,
): {
  context: ICommandHostContext;
  spies: IRuntimeSpies;
} {
  let mode: TPermissionMode = 'default';
  const setPermissionMode = vi.fn((next: TPermissionMode) => {
    mode = next;
  });
  const spies: IRuntimeSpies = { setPermissionMode };

  const runtime: ICommandSessionRuntime = {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode,
    getSessionId: () => 'session_1',
    getMessageCount: () => 0,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => 0.8,
    getFullHistory: () => [],
    getHistory: () => [],
  };

  if (includeActivePreset) {
    const setActivePresetId = vi.fn();
    runtime.setActivePresetId = setActivePresetId;
    spies.setActivePresetId = setActivePresetId;
  }

  if (includeApplyModelOptions) {
    const applyModelOptions = vi.fn();
    runtime.applyModelOptions = applyModelOptions;
    spies.applyModelOptions = applyModelOptions;
  }

  const context: ICommandHostContext = {
    getSession: () => runtime,
    getContextState: () => CONTEXT_STATE,
    getAutoCompactThreshold: () => 0.8,
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => {
      throw new Error('not used');
    },
    rollbackEditCheckpoint: async () => {
      throw new Error('not used');
    },
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
  };

  if (includeApplyPersona) {
    const applyPersona = vi.fn();
    context.applyPersona = applyPersona;
    spies.applyPersona = applyPersona;
  }

  if (includeApplyCommandModuleSelection) {
    const applyCommandModuleSelection = vi.fn();
    context.applyCommandModuleSelection = applyCommandModuleSelection;
    spies.applyCommandModuleSelection = applyCommandModuleSelection;
  }

  return { context, spies };
}

describe('applyPresetToSession (PRESET-012)', () => {
  it('TC-01: applies permissionMode to the live runtime', () => {
    const { context, spies } = createContext();
    applyPresetToSession(context, 'careful-reviewer', { permissionMode: 'default' });
    expect(spies.setPermissionMode).toHaveBeenCalledWith('default');
  });

  it('TC-02: records the active preset id', () => {
    const { context, spies } = createContext();
    applyPresetToSession(context, 'careful-reviewer', { permissionMode: 'default' });
    expect(spies.setActivePresetId).toHaveBeenCalledWith('careful-reviewer');
  });

  it('TC-03: no permissionMode → setPermissionMode not called, group skipped', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'x', {});
    expect(spies.setPermissionMode).not.toHaveBeenCalled();
    expect(result.skipped).toContain('permissionMode');
    expect(result.applied).not.toContain('permissionMode');
  });

  it('TC-04: permissionMode present → group reported as applied', () => {
    const { context } = createContext();
    const result = applyPresetToSession(context, 'x', { permissionMode: 'acceptEdits' });
    expect(result.applied).toContain('permissionMode');
  });

  it('TC-05: runtime without setActivePresetId still applies safely (optional chaining)', () => {
    const { context, spies } = createContext(false);
    expect(spies.setActivePresetId).toBeUndefined();
    expect(() =>
      applyPresetToSession(context, 'careful-reviewer', { permissionMode: 'plan' }),
    ).not.toThrow();
    expect(spies.setPermissionMode).toHaveBeenCalledWith('plan');
  });
});

describe('applyPresetToSession model group (PRESET-013)', () => {
  it('TC-04: effort + temperature applied → applyModelOptions called, result.applied lists them', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'careful-reviewer', {
      effort: 'high',
      temperature: 0.5,
      maxOutputTokens: 2048,
    });

    expect(spies.applyModelOptions).toHaveBeenCalledWith({
      effort: 'high',
      temperature: 0.5,
      maxOutputTokens: 2048,
    });
    expect(result.applied).toContain('effort');
    expect(result.applied).toContain('temperature');
    expect(result.applied).toContain('maxOutputTokens');
  });

  it('TC-05: only permissionMode → applyModelOptions not called, model groups skipped', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'x', { permissionMode: 'default' });

    expect(spies.applyModelOptions).not.toHaveBeenCalled();
    expect(result.skipped).toContain('model');
    expect(result.skipped).toContain('effort');
    expect(result.skipped).toContain('temperature');
    expect(result.skipped).toContain('maxOutputTokens');
  });

  it('TC-06: runtime without applyModelOptions still applies safely (optional chaining)', () => {
    const { context, spies } = createContext(true, false);
    expect(spies.applyModelOptions).toBeUndefined();
    expect(() =>
      applyPresetToSession(context, 'careful-reviewer', { effort: 'high' }),
    ).not.toThrow();
  });
});

describe('applyPresetToSession persona group (PRESET-014)', () => {
  it('TC-03: persona present → applyPersona called with it, result.applied lists persona', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'careful-reviewer', { persona: 'P' });

    expect(spies.applyPersona).toHaveBeenCalledWith('P');
    expect(result.applied).toContain('persona');
  });

  it('TC-04: no persona → applyPersona not called, persona group skipped', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'x', {});

    expect(spies.applyPersona).not.toHaveBeenCalled();
    expect(result.skipped).toContain('persona');
    expect(result.applied).not.toContain('persona');
  });

  it('TC-05: context without applyPersona still applies safely (optional chaining)', () => {
    const { context, spies } = createContext(true, true, false);
    expect(spies.applyPersona).toBeUndefined();
    expect(() => applyPresetToSession(context, 'careful-reviewer', { persona: 'P' })).not.toThrow();
  });
});

describe('applyPresetToSession command-module group (PRESET-015)', () => {
  it('TC-04: disabledCommandModules → applyCommandModuleSelection called with (undefined, [x]), applied lists commandModules', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'careful-reviewer', {
      disabledCommandModules: ['x'],
    });

    expect(spies.applyCommandModuleSelection).toHaveBeenCalledWith(undefined, ['x']);
    expect(result.applied).toContain('commandModules');
  });

  it('TC-05: no command-module fields → not called, commandModules group skipped', () => {
    const { context, spies } = createContext();
    const result = applyPresetToSession(context, 'x', {});

    expect(spies.applyCommandModuleSelection).not.toHaveBeenCalled();
    expect(result.skipped).toContain('commandModules');
    expect(result.applied).not.toContain('commandModules');
  });

  it('TC-06: context without applyCommandModuleSelection still applies safely (optional chaining)', () => {
    const { context, spies } = createContext(true, true, true, false);
    expect(spies.applyCommandModuleSelection).toBeUndefined();
    expect(() =>
      applyPresetToSession(context, 'careful-reviewer', { enabledCommandModules: ['a'] }),
    ).not.toThrow();
  });
});
