import { describe, expect, it } from 'vitest';

import { resolveCliPreset, selectPresetId } from '../preset-selection.js';

import type { IParsedCliArgs } from '../../utils/cli-args.js';

/** Minimal IParsedCliArgs fixture — every field defaults to its "unset" value. */
function makeArgs(overrides: Partial<IParsedCliArgs> = {}): IParsedCliArgs {
  return {
    positional: [],
    help: false,
    printMode: false,
    serve: false,
    continueMode: false,
    resumeId: undefined,
    language: undefined,
    permissionMode: undefined,
    maxTurns: undefined,
    goal: undefined,
    goalMaxIterations: undefined,
    forkSession: false,
    sessionName: undefined,
    outputFormat: undefined,
    format: undefined,
    summary: undefined,
    source: undefined,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    taskFile: undefined,
    version: false,
    reset: false,
    bare: false,
    allowedTools: undefined,
    deniedTools: undefined,
    model: undefined,
    preset: undefined,
    noSessionPersistence: false,
    jsonSchema: undefined,
    configure: false,
    configureProvider: undefined,
    provider: undefined,
    sessionLog: undefined,
    providerType: undefined,
    baseURL: undefined,
    apiKey: undefined,
    apiKeyEnv: undefined,
    setCurrent: false,
    settingsScope: undefined,
    checkUpdate: false,
    disableUpdateCheck: false,
    dryRun: false,
    yes: false,
    ...overrides,
  };
}

describe('selectPresetId', () => {
  it('TC-03: honors settings.preset when no --preset flag is given', () => {
    expect(selectPresetId({ preset: undefined }, 'default')).toBe('default');
  });

  it('TC-04: --preset flag overrides settings.preset', () => {
    expect(selectPresetId({ preset: 'x' }, 'default')).toBe('x');
  });

  it('falls back to "default" when neither flag nor settings provides an id', () => {
    expect(selectPresetId({ preset: undefined }, undefined)).toBe('default');
  });
});

describe('resolveCliPreset', () => {
  it('TC-05: --model flows through cliOverrides into the resolved bundle', () => {
    const resolved = resolveCliPreset(makeArgs({ model: 'm' }), undefined);
    expect(resolved.model).toBe('m');
  });

  it('TC-02: unknown preset id throws with the available preset list', () => {
    expect(() => resolveCliPreset(makeArgs({ preset: '__nope__' }), undefined)).toThrow(/default/);
  });

  it('TC-01: default preset with no flags resolves to a no-op (no model injected)', () => {
    const resolved = resolveCliPreset(makeArgs(), undefined);
    expect(resolved).toEqual({});
  });
});
