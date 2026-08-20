import { describe, expect, it, vi } from 'vitest';

import { applyPresetToSession } from '../preset-application.js';

import type { ICommandHostContext, ICommandSessionRuntime } from '../../host-context.js';
import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import {
  createTestCommandHost,
  createTestSessionRuntime,
} from '@robota-sdk/agent-framework/testing';

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
  applyAgentName?: ReturnType<typeof vi.fn>;
  applyPersona?: ReturnType<typeof vi.fn>;
  applyResponseLanguage?: ReturnType<typeof vi.fn>;
  applyCommandModuleSelection?: ReturnType<typeof vi.fn>;
  setParallelSubagentsEnabled?: ReturnType<typeof vi.fn>;
  applySelfVerification?: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal ICommandHostContext whose runtime records permission-mode / active-preset /
 * model-option writes. `includeActivePreset: false` omits the optional `setActivePresetId` to
 * exercise the defensive optional-chaining path (PRESET-012 TC-05). `includeApplyModelOptions:
 * false` omits the optional `applyModelOptions` to exercise the PRESET-013 optional path (TC-06).
 * `includeApplyPersona: false` omits the optional `applyPersona` to exercise the PRESET-014
 * optional path (TC-05). `includeApplyCommandModuleSelection: false` omits the optional
 * `applyCommandModuleSelection` to exercise the PRESET-015 optional path (TC-06).
 * `includeSetParallelSubagentsEnabled: false` omits the optional `setParallelSubagentsEnabled` to
 * exercise the PRESET-016 optional path (TC-06). `includeApplySelfVerification: false` omits the
 * optional `applySelfVerification` to exercise the PRESET-017 optional path (TC-05).
 */
function createContext(
  includeActivePreset = true,
  includeApplyModelOptions = true,
  includeApplyPersona = true,
  includeApplyCommandModuleSelection = true,
  includeSetParallelSubagentsEnabled = true,
  includeApplySelfVerification = true,
): {
  context: ReturnType<typeof createTestCommandHost>;
  spies: IRuntimeSpies;
} {
  let mode: TPermissionMode = 'default';
  const setPermissionMode = vi.fn((next: TPermissionMode) => {
    mode = next;
  });
  const spies: IRuntimeSpies = { setPermissionMode };
  const recordSpy = (name: keyof IRuntimeSpies) => {
    const spy = vi.fn();
    spies[name] = spy;
    return spy;
  };

  // ARCH-029 TC-06: every runtime member is now REQUIRED, so "a runtime without member X" is no
  // longer a representable host. What the `include*` flags used to model — the caller surviving a
  // host that does not participate in a group — is now modelled the way the design says it must be:
  // the member is PRESENT and does nothing. The distinction the contract keeps is between a value
  // that is legitimately empty and a member that is absent; only the first one survives.
  //
  // The assertions are unchanged: a flag left false simply does not install a recording spy, so
  // `spies.X` is still undefined and the case still proves the caller does not depend on the spy.
  const runtime = createTestSessionRuntime({
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode,
    getSessionId: () => 'session_1',
    getAutoCompactThreshold: () => 0.8,
    ...(includeActivePreset && { setActivePresetId: recordSpy('setActivePresetId') }),
    ...(includeApplyModelOptions && { applyModelOptions: recordSpy('applyModelOptions') }),
    applyAgentName: recordSpy('applyAgentName'),
    ...(includeSetParallelSubagentsEnabled && {
      setParallelSubagentsEnabled: recordSpy('setParallelSubagentsEnabled'),
    }),
  });

  const context = createTestCommandHost({
    overrides: {
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
    },
  });

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

  if (includeApplySelfVerification) {
    const applySelfVerification = vi.fn();
    context.applySelfVerification = applySelfVerification;
    spies.applySelfVerification = applySelfVerification;
  }

  return { context, spies };
}

describe('applyPresetToSession (PRESET-012)', () => {
  it('TC-01: applies permissionMode to the live runtime', async () => {
    const { context, spies } = createContext();
    await applyPresetToSession(context, 'careful-reviewer', { permissionMode: 'default' });
    expect(spies.setPermissionMode).toHaveBeenCalledWith('default');
  });

  it('TC-02: records the active preset id', async () => {
    const { context, spies } = createContext();
    await applyPresetToSession(context, 'careful-reviewer', { permissionMode: 'default' });
    expect(spies.setActivePresetId).toHaveBeenCalledWith('careful-reviewer');
  });

  it('TC-03: no permissionMode → setPermissionMode not called, group skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', {});
    expect(spies.setPermissionMode).not.toHaveBeenCalled();
    expect(result.skipped).toContain('permissionMode');
    expect(result.applied).not.toContain('permissionMode');
  });

  it('TC-04: permissionMode present → group reported as applied', async () => {
    const { context } = createContext();
    const result = await applyPresetToSession(context, 'x', { permissionMode: 'acceptEdits' });
    expect(result.applied).toContain('permissionMode');
  });

  it('ARCH-029: a runtime whose setActivePresetId does NOTHING still applies the rest', async () => {
    // Rewritten, not kept. The old title read "runtime without setActivePresetId" and the member is
    // now required, so that host is unrepresentable — and the body only asserted that the FIXTURE
    // had not installed a spy, which is a fact about the helper rather than about production code.
    // The distinction the contract keeps is value-level: the member is present and inert.
    const { context, spies } = createContext(false);

    const result = await applyPresetToSession(context, 'careful-reviewer', {
      permissionMode: 'plan',
    });

    expect(context.getSession().setActivePresetId).toBeTypeOf('function');
    expect(spies.setPermissionMode).toHaveBeenCalledWith('plan');
    expect(result.applied).toContain('permissionMode');
  });
});

describe('applyPresetToSession model group (PRESET-013)', () => {
  it('TC-04: effort + temperature applied → applyModelOptions called, result.applied lists them', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'careful-reviewer', {
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

  it('TC-05: only permissionMode → applyModelOptions not called, model groups skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', { permissionMode: 'default' });

    expect(spies.applyModelOptions).not.toHaveBeenCalled();
    expect(result.skipped).toContain('model');
    expect(result.skipped).toContain('effort');
    expect(result.skipped).toContain('temperature');
    expect(result.skipped).toContain('maxOutputTokens');
  });

  it('ARCH-029: an inert applyModelOptions still leaves the model group applied', async () => {
    // ARCH-029: rewritten. The old title said "without <member>" and the member is now required,
    // so that host is unrepresentable; the old body asserted only that the FIXTURE had installed
    // no spy. What survives is the value-level distinction the contract keeps: the member is
    // PRESENT and inert, and the group is still reported as applied.
    const { context } = createContext(true, false);

    const result = await applyPresetToSession(context, 'careful-reviewer', { effort: 'high' });

    expect(context.getSession().applyModelOptions).toBeTypeOf('function');
    expect(result.applied).toContain('effort');
  });
});

describe('applyPresetToSession identity group (ARCH-040)', () => {
  // The REVERSE divergence, and the one nobody had named: startup applied the preset's `agentName`
  // and the live path did not, so switching to the SAME preset mid-session left the old name. One
  // preset, two answers, decided by WHEN it was chosen. Owner decision 2026-08-20: `/preset` renames.
  it('renames the live agent when the preset carries an agentName', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'acme', { agentName: 'acme-bot' });
    expect(spies.applyAgentName).toHaveBeenCalledWith('acme-bot');
    expect(result.applied).toContain('agentName');
  });

  it('leaves the name alone when the preset carries none, and says so', async () => {
    // `skipped` is the honest report: "this preset said nothing about the name" is a different
    // statement from "the name was set to undefined", and only one of them is true.
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'acme', { permissionMode: 'default' });
    expect(spies.applyAgentName).not.toHaveBeenCalled();
    expect(result.skipped).toContain('agentName');
  });
});

describe('applyPresetToSession language group (ARCH-040)', () => {
  // `language` had no seam anywhere and was the last of the ten fields to be decidable from an
  // existing mechanism: the framework already composes a response-language prompt section, so the
  // owner's decision — a prompt instruction, not a provider parameter — wires what is there rather
  // than inventing a second place for the same idea.
  it('re-applies the language through the live rebuild seam', async () => {
    const { context } = createContext();
    const applyResponseLanguage = vi.fn();
    (context as unknown as Record<string, unknown>)['applyResponseLanguage'] =
      applyResponseLanguage;

    const result = await applyPresetToSession(context, 'acme', { language: 'ko' });

    expect(applyResponseLanguage).toHaveBeenCalledWith('ko');
    expect(result.applied).toContain('language');
  });

  it('reports the group skipped when the preset names no language', async () => {
    // "this preset said nothing about language" and "the language was set to undefined" are
    // different statements, and only one of them is true.
    const { context } = createContext();
    const applyResponseLanguage = vi.fn();
    (context as unknown as Record<string, unknown>)['applyResponseLanguage'] =
      applyResponseLanguage;

    const result = await applyPresetToSession(context, 'acme', { permissionMode: 'default' });

    expect(applyResponseLanguage).not.toHaveBeenCalled();
    expect(result.skipped).toContain('language');
  });
});

describe('applyPresetToSession seeding-prompt group (ARCH-040)', () => {
  it('re-applies the preset system prompt through the live rebuild seam', async () => {
    const { context } = createContext();
    const applyPresetSystemPrompt = vi.fn();
    (context as unknown as Record<string, unknown>)['applyPresetSystemPrompt'] =
      applyPresetSystemPrompt;

    const result = await applyPresetToSession(context, 'acme', { systemPrompt: 'seed text' });

    expect(applyPresetSystemPrompt).toHaveBeenCalledWith('seed text');
    expect(result.applied).toContain('systemPrompt');
  });

  it('reports the group skipped when the preset names none', async () => {
    const { context } = createContext();
    const applyPresetSystemPrompt = vi.fn();
    (context as unknown as Record<string, unknown>)['applyPresetSystemPrompt'] =
      applyPresetSystemPrompt;

    const result = await applyPresetToSession(context, 'acme', { permissionMode: 'default' });

    expect(applyPresetSystemPrompt).not.toHaveBeenCalled();
    expect(result.skipped).toContain('systemPrompt');
  });
});

describe('applyPresetToSession persona group (PRESET-014)', () => {
  it('TC-03: persona present → applyPersona called with it, result.applied lists persona', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'careful-reviewer', { persona: 'P' });

    expect(spies.applyPersona).toHaveBeenCalledWith('P');
    expect(result.applied).toContain('persona');
  });

  it('TC-04: no persona → applyPersona not called, persona group skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', {});

    expect(spies.applyPersona).not.toHaveBeenCalled();
    expect(result.skipped).toContain('persona');
    expect(result.applied).not.toContain('persona');
  });

  it('ARCH-029: an inert applyPersona still leaves the persona group applied', async () => {
    // ARCH-029: rewritten. The old title said "without <member>" and the member is now required,
    // so that host is unrepresentable; the old body asserted only that the FIXTURE had installed
    // no spy. What survives is the value-level distinction the contract keeps: the member is
    // PRESENT and inert, and the group is still reported as applied.
    const { context } = createContext(true, true, false);

    const result = await applyPresetToSession(context, 'careful-reviewer', { persona: 'P' });

    expect(context.applyPersona).toBeTypeOf('function');
    expect(result.applied).toContain('persona');
  });
});

describe('applyPresetToSession command-module group (PRESET-015)', () => {
  it('TC-04: disabledCommandModules → applyCommandModuleSelection called with (undefined, [x]), applied lists commandModules', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'careful-reviewer', {
      disabledCommandModules: ['x'],
    });

    expect(spies.applyCommandModuleSelection).toHaveBeenCalledWith(undefined, ['x']);
    expect(result.applied).toContain('commandModules');
  });

  it('TC-05: no command-module fields → not called, commandModules group skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', {});

    expect(spies.applyCommandModuleSelection).not.toHaveBeenCalled();
    expect(result.skipped).toContain('commandModules');
    expect(result.applied).not.toContain('commandModules');
  });

  it('ARCH-029: an inert applyCommandModuleSelection reports no unknowns, as a VALUE', async () => {
    // ARCH-029: rewritten. The old title said "without <member>" and the member is now required,
    // so that host is unrepresentable; the old body asserted only that the FIXTURE had installed
    // no spy. What survives is the value-level distinction the contract keeps: the member is
    // PRESENT and inert, and the group is still reported as applied.
    // The empty array is now unambiguous: it means "every name matched" (INFRA-032), not "the seam
    // was absent so nothing could be detected". Those two readings were indistinguishable before.
    const { context } = createContext(true, true, true, false);

    const result = await applyPresetToSession(context, 'careful-reviewer', {
      enabledCommandModules: ['a'],
    });

    expect(context.applyCommandModuleSelection).toBeTypeOf('function');
    expect(result.unknownCommandModules).toEqual([]);
    expect(result.applied).toContain('commandModules');
  });

  it('INFRA-032: unknowns returned by the seam are carried on result.unknownCommandModules', async () => {
    const { context, spies } = createContext();
    spies.applyCommandModuleSelection?.mockReturnValue([{ name: 'editor', kind: 'disabled' }]);
    const result = await applyPresetToSession(context, 'careful-reviewer', {
      disabledCommandModules: ['editor'],
    });
    expect(result.unknownCommandModules).toEqual([{ name: 'editor', kind: 'disabled' }]);
    // Non-fatal: the group is still reported as applied.
    expect(result.applied).toContain('commandModules');
  });

  it('INFRA-032: command-module group skipped → unknownCommandModules is empty', async () => {
    const { context } = createContext();
    const result = await applyPresetToSession(context, 'x', {});
    expect(result.unknownCommandModules).toEqual([]);
  });
});

describe('applyPresetToSession parallel-subagents gate (PRESET-016)', () => {
  it('TC-05: enableParallelSubagents:false → setParallelSubagentsEnabled(false), applied lists it', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'careful-reviewer', {
      enableParallelSubagents: false,
    });

    expect(spies.setParallelSubagentsEnabled).toHaveBeenCalledWith(false);
    expect(result.applied).toContain('enableParallelSubagents');
  });

  it('TC-06: omitted → not called, group skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', {});

    expect(spies.setParallelSubagentsEnabled).not.toHaveBeenCalled();
    expect(result.skipped).toContain('enableParallelSubagents');
    expect(result.applied).not.toContain('enableParallelSubagents');
  });

  it('ARCH-029: an inert setParallelSubagentsEnabled still leaves the gate applied', async () => {
    // ARCH-029: rewritten. The old title said "without <member>" and the member is now required,
    // so that host is unrepresentable; the old body asserted only that the FIXTURE had installed
    // no spy. What survives is the value-level distinction the contract keeps: the member is
    // PRESENT and inert, and the group is still reported as applied.
    const { context } = createContext(true, true, true, true, false);

    const result = await applyPresetToSession(context, 'careful-reviewer', {
      enableParallelSubagents: true,
    });

    expect(context.getSession().setParallelSubagentsEnabled).toBeTypeOf('function');
    expect(result.applied).toContain('enableParallelSubagents');
  });
});

describe('applyPresetToSession self-verification group (PRESET-017)', () => {
  it('TC-04: selfVerification:true → applySelfVerification(true), applied lists it', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'careful-reviewer', {
      selfVerification: true,
    });

    expect(spies.applySelfVerification).toHaveBeenCalledWith(true);
    expect(result.applied).toContain('selfVerification');
  });

  it('TC-05: omitted → not called, group skipped', async () => {
    const { context, spies } = createContext();
    const result = await applyPresetToSession(context, 'x', {});

    expect(spies.applySelfVerification).not.toHaveBeenCalled();
    expect(result.skipped).toContain('selfVerification');
    expect(result.applied).not.toContain('selfVerification');
  });

  it('ARCH-029: an inert applySelfVerification still leaves the group applied', async () => {
    // ARCH-029: rewritten. The old title said "without <member>" and the member is now required,
    // so that host is unrepresentable; the old body asserted only that the FIXTURE had installed
    // no spy. What survives is the value-level distinction the contract keeps: the member is
    // PRESENT and inert, and the group is still reported as applied.
    const { context } = createContext(true, true, true, true, true, false);

    const result = await applyPresetToSession(context, 'careful-reviewer', {
      selfVerification: true,
    });

    expect(context.applySelfVerification).toBeTypeOf('function');
    expect(result.applied).toContain('selfVerification');
  });
});
