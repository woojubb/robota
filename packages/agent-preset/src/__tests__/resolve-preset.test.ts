import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_NAME, getPreset, listPresets, resolvePreset } from '../resolve-preset.js';

import type { IPreset, TResolvedPresetOptions } from '../preset-types.js';

describe('resolvePreset', () => {
  it('TC-05: default preset is a no-op — returns the cliOverrides unchanged', () => {
    const base: TResolvedPresetOptions = {
      model: 'base-model',
      effort: 'high',
      agentName: 'tester',
    };
    expect(resolvePreset('default', { cliOverrides: base })).toEqual(base);
  });

  it('TC-06: explicit overrides win over cliOverrides', () => {
    const result = resolvePreset('default', {
      cliOverrides: { model: 'a' },
      explicit: { model: 'b' },
    });
    expect(result).toEqual({ model: 'b' });
  });

  it('TC-06: cliOverrides apply over the empty default preset', () => {
    const result = resolvePreset('default', { cliOverrides: { model: 'cli-model' } });
    expect(result).toEqual({ model: 'cli-model' });
  });

  it('TC-06: undefined values in higher layers do not clobber lower layers', () => {
    const result = resolvePreset('default', {
      cliOverrides: { model: 'cli-model', effort: 'high' },
      explicit: { model: undefined, temperature: 0.5 },
    });
    expect(result).toEqual({ model: 'cli-model', effort: 'high', temperature: 0.5 });
  });

  it('throws with the available-preset list for an unknown id', () => {
    expect(() => resolvePreset('does-not-exist')).toThrowError(
      'Unknown preset: "does-not-exist". Available presets: default, autonomous-builder.',
    );
  });
});

describe('listPresets', () => {
  it('TC-07: contains an entry with id === "default"', () => {
    const presets = listPresets();
    expect(presets.some((preset) => preset.id === 'default')).toBe(true);
  });

  it('returns only the { id, title, description } summary shape', () => {
    const summary = listPresets().find((preset) => preset.id === 'default');
    expect(summary).toEqual({
      id: 'default',
      title: 'Default',
      description:
        'Neutral baseline preset — no overrides; reproduces the standard agent behaviour.',
    });
  });
});

describe('PRESET-003 agentName ownership + persona', () => {
  /** Mirrors the thin-shell resolution in cli.ts: `resolvedPreset.agentName ?? DEFAULT_AGENT_NAME`. */
  function resolveAgentName(resolved: TResolvedPresetOptions): string {
    return resolved.agentName ?? DEFAULT_AGENT_NAME;
  }

  it('TC-07: default preset (no agentName) → forwarded agentName equals DEFAULT_AGENT_NAME', () => {
    const resolved = resolvePreset('default');
    expect(resolved.agentName).toBeUndefined();
    expect(resolveAgentName(resolved)).toBe(DEFAULT_AGENT_NAME);
  });

  it('TC-07: preset with an agentName → forwarded agentName equals the preset value', () => {
    const resolved = resolvePreset('default', { explicit: { agentName: 'custom-agent' } });
    expect(resolveAgentName(resolved)).toBe('custom-agent');
  });

  it('default identity constant is owned by agent-preset and is generic (no vendor literal)', () => {
    expect(typeof DEFAULT_AGENT_NAME).toBe('string');
    expect(DEFAULT_AGENT_NAME.length).toBeGreaterThan(0);
  });

  it('TC-01: IPreset / TResolvedPresetOptions accept an optional persona block', () => {
    const preset: IPreset = {
      id: 'with-persona',
      title: 'With Persona',
      description: 'carries a persona block',
      persona: 'Be concise and proactive.',
    };
    expect(preset.persona).toBe('Be concise and proactive.');
  });

  it('default preset carries no persona (empty persona = no section = no regression)', () => {
    expect(resolvePreset('default').persona).toBeUndefined();
  });
});

describe('PRESET-004 autonomy / defaultPermissionMode → permissionMode', () => {
  it('TC-06: autonomy "act-first" (no explicit mode) → permissionMode "acceptEdits"', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'act-first' } });
    expect(result.permissionMode).toBe('acceptEdits');
    expect(result.autonomy).toBe('act-first');
  });

  it('TC-07: autonomy "ask-first" (no explicit mode) → permissionMode "default" (ask-on-write)', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'ask-first' } });
    expect(result.permissionMode).toBe('default');
  });

  it('TC-06: autonomy "balanced" (no explicit mode) → permissionMode "default"', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'balanced' } });
    expect(result.permissionMode).toBe('default');
  });

  it('TC-05: defaultPermissionMode (no explicit permissionMode) is promoted to permissionMode', () => {
    const result = resolvePreset('default', {
      explicit: { defaultPermissionMode: 'plan' },
    });
    expect(result.permissionMode).toBe('plan');
  });

  it('explicit permissionMode wins over defaultPermissionMode and autonomy mapping', () => {
    const result = resolvePreset('default', {
      explicit: {
        permissionMode: 'bypassPermissions',
        defaultPermissionMode: 'plan',
        autonomy: 'ask-first',
      },
    });
    expect(result.permissionMode).toBe('bypassPermissions');
  });

  it('defaultPermissionMode wins over the autonomy mapping', () => {
    const result = resolvePreset('default', {
      explicit: { defaultPermissionMode: 'plan', autonomy: 'act-first' },
    });
    expect(result.permissionMode).toBe('plan');
  });

  it('default preset stays a no-op — no autonomy/mode → result has no permissionMode', () => {
    expect(resolvePreset('default')).toEqual({});
    expect(resolvePreset('default').permissionMode).toBeUndefined();
  });

  it('no-op preset preserves the PRESET-001 cliOverrides-unchanged contract', () => {
    const base: TResolvedPresetOptions = { model: 'm', effort: 'high', agentName: 'a' };
    expect(resolvePreset('default', { cliOverrides: base })).toEqual(base);
  });
});

describe('PRESET-005 autonomous-builder', () => {
  it('TC-01: persona is non-empty and includes the portable behaviour-guide keyword groups', () => {
    const { persona } = resolvePreset('autonomous-builder');
    expect(persona).toBeDefined();
    expect((persona ?? '').length).toBeGreaterThan(0);
    const text = (persona ?? '').toLowerCase();

    // proactivity / high autonomy
    expect(text).toMatch(/proceed and|act rather than stop to ask/);
    // non-sycophantic honesty + own-your-mistakes + even-handedness (at least one of the portable set)
    expect(text).toMatch(/sycophantic|even-handed|own it|get something wrong/);
    // scope-constraint phrasing
    expect(text).toMatch(/do not refactor|expand scope|simplest thing that works/);
    // tool-result grounding
    expect(text).toMatch(/tool result|ground your claims|not yet verified/);
  });

  it('TC-02: effort === "high"', () => {
    expect(resolvePreset('autonomous-builder').effort).toBe('high');
  });

  it('TC-03: autonomy === "act-first"', () => {
    expect(resolvePreset('autonomous-builder').autonomy).toBe('act-first');
  });

  it('TC-04: enableParallelSubagents === true', () => {
    expect(resolvePreset('autonomous-builder').enableParallelSubagents).toBe(true);
  });

  it('TC-05: selfVerification === true', () => {
    expect(resolvePreset('autonomous-builder').selfVerification).toBe(true);
  });

  it('TC-09: listPresets() includes autonomous-builder with non-empty title/description', () => {
    const summary = listPresets().find((preset) => preset.id === 'autonomous-builder');
    expect(summary).toBeDefined();
    expect((summary?.title ?? '').length).toBeGreaterThan(0);
    expect((summary?.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('getPreset', () => {
  it('returns the default preset by id', () => {
    expect(getPreset('default')?.id).toBe('default');
  });

  it('returns undefined for an unknown id', () => {
    expect(getPreset('missing')).toBeUndefined();
  });
});
