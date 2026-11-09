import { describe, expect, it } from 'vitest';

import { createPresetRegistry } from '../resolve-preset.js';

// There are no module-global readers. The built-ins are what a registry constructed with no
// external presets holds, which is exactly what these cases are about — the list is this test's,
// not the process's.
const { resolvePreset, listPresets, getPreset } = createPresetRegistry();

import type { IPreset, IResolvedPresetOptions } from '../preset-types.js';
import type { IPresetApplicationOptions } from '@robota-sdk/agent-framework';

describe('resolvePreset', () => {
  it('default preset is a no-op — returns the cliOverrides unchanged', () => {
    const base: IResolvedPresetOptions = {
      model: 'base-model',
      effort: 'high',
      agentName: 'tester',
    };
    expect(resolvePreset('default', { cliOverrides: base })).toEqual(base);
  });

  it('explicit overrides win over cliOverrides', () => {
    const result = resolvePreset('default', {
      cliOverrides: { model: 'a' },
      explicit: { model: 'b' },
    });
    expect(result).toEqual({ model: 'b' });
  });

  it('cliOverrides apply over the empty default preset', () => {
    const result = resolvePreset('default', { cliOverrides: { model: 'cli-model' } });
    expect(result).toEqual({ model: 'cli-model' });
  });

  it('undefined values in higher layers do not clobber lower layers', () => {
    const result = resolvePreset('default', {
      cliOverrides: { model: 'cli-model', effort: 'high' },
      explicit: { model: undefined, temperature: 0.5 },
    });
    expect(result).toEqual({ model: 'cli-model', effort: 'high', temperature: 0.5 });
  });

  it('throws with the available-preset list for an unknown id', () => {
    expect(() => resolvePreset('does-not-exist')).toThrowError(
      'Unknown preset: "does-not-exist". Available presets: default, autonomous-builder, careful-reviewer, neutral-executor.',
    );
  });
});

/**
 * The two tool lists combine DIFFERENTLY, and a rule about
 * combination can fail in either direction. Both are asserted because asserting one leaves the other
 * free to be an accident: a union that should replace looks identical to a replace on a case where
 * the earlier layer was empty.
 */
describe('preset tool lists combine by the decided rule', () => {
  it('an allowlist REPLACES — it states the complete permitted set', () => {
    const result = resolvePreset('default', {
      cliOverrides: { allowedTools: ['Read', 'Grep'] },
      explicit: { allowedTools: ['Bash'] },
    });
    // NOT ['Read','Grep','Bash']: a later, more specific layer supersedes the earlier answer rather
    // than widening it, and NOT [] either — intersecting would let an earlier layer veto a tool the
    // operator just named.
    expect(result.allowedTools).toEqual(['Bash']);
  });

  it('a denylist UNIONS — a denial is not weakened by a layer that forgot to repeat it', () => {
    const result = resolvePreset('default', {
      cliOverrides: { deniedTools: ['Bash'] },
      explicit: { deniedTools: ['WebFetch'] },
    });
    expect(result.deniedTools).toEqual(['Bash', 'WebFetch']);
  });

  it('the denylist union drops duplicates rather than repeating a denial', () => {
    const result = resolvePreset('default', {
      cliOverrides: { deniedTools: ['Bash', 'WebFetch'] },
      explicit: { deniedTools: ['WebFetch'] },
    });
    expect(result.deniedTools).toEqual(['Bash', 'WebFetch']);
  });

  it('a layer that states neither list changes neither', () => {
    // The guard on the two above: `mergeDefined` must not manufacture an empty denylist for a layer
    // that never mentioned one, which would read as "nothing is denied" on the surface.
    const result = resolvePreset('default', {
      cliOverrides: { deniedTools: ['Bash'] },
      explicit: { model: 'x' },
    });
    expect(result.deniedTools).toEqual(['Bash']);
    expect(result.allowedTools).toBeUndefined();
  });
});

describe('listPresets', () => {
  it('contains an entry with id === "default"', () => {
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

describe('agentName ownership + persona', () => {
  it('default preset does not choose a product identity', () => {
    expect(resolvePreset('default').agentName).toBeUndefined();
  });

  it('a caller-supplied agentName remains the resolved value', () => {
    const resolved = resolvePreset('default', { explicit: { agentName: 'custom-agent' } });
    expect(resolved.agentName).toBe('custom-agent');
  });

  it('IPreset / IResolvedPresetOptions accept an optional persona block', () => {
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

describe('autonomy / defaultPermissionMode → permissionMode', () => {
  it('autonomy "act-first" (no explicit mode) → permissionMode "acceptEdits"', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'act-first' } });
    expect(result.permissionMode).toBe('acceptEdits');
    expect(result.autonomy).toBe('act-first');
  });

  it('autonomy "ask-first" (no explicit mode) → permissionMode "default" (ask-on-write)', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'ask-first' } });
    expect(result.permissionMode).toBe('default');
  });

  it('autonomy "balanced" (no explicit mode) → permissionMode "default"', () => {
    const result = resolvePreset('default', { explicit: { autonomy: 'balanced' } });
    expect(result.permissionMode).toBe('default');
  });

  it('defaultPermissionMode (no explicit permissionMode) is promoted to permissionMode', () => {
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

  it('no-op preset preserves the cliOverrides-unchanged contract', () => {
    const base: IResolvedPresetOptions = { model: 'm', effort: 'high', agentName: 'a' };
    expect(resolvePreset('default', { cliOverrides: base })).toEqual(base);
  });
});

describe('autonomous-builder', () => {
  it('persona is non-empty and includes the portable behaviour-guide keyword groups', () => {
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

  it('effort === "high"', () => {
    expect(resolvePreset('autonomous-builder').effort).toBe('high');
  });

  it('autonomy === "act-first"', () => {
    expect(resolvePreset('autonomous-builder').autonomy).toBe('act-first');
  });

  it('enableParallelSubagents === true', () => {
    expect(resolvePreset('autonomous-builder').enableParallelSubagents).toBe(true);
  });

  it('selfVerification === true', () => {
    expect(resolvePreset('autonomous-builder').selfVerification).toBe(true);
  });

  it('listPresets() includes autonomous-builder with non-empty title/description', () => {
    const summary = listPresets().find((preset) => preset.id === 'autonomous-builder');
    expect(summary).toBeDefined();
    expect((summary?.title ?? '').length).toBeGreaterThan(0);
    expect((summary?.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('careful-reviewer', () => {
  it('autonomy === "ask-first"', () => {
    expect(resolvePreset('careful-reviewer').autonomy).toBe('ask-first');
  });

  it('selfVerification === true', () => {
    expect(resolvePreset('careful-reviewer').selfVerification).toBe(true);
  });

  it('enableParallelSubagents === false', () => {
    expect(resolvePreset('careful-reviewer').enableParallelSubagents).toBe(false);
  });

  it('effort is SET (one of the known tiers, not undefined)', () => {
    const { effort } = resolvePreset('careful-reviewer');
    expect(effort).toBeDefined();
    expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(effort);
  });

  it('persona contains ask-before-write / plan-first and wait-before-change phrasing', () => {
    const { persona } = resolvePreset('careful-reviewer');
    expect(persona).toBeDefined();
    const text = (persona ?? '').toLowerCase();
    // ask-before-write / plan-first
    expect(text).toMatch(/read and analyse before you change|lay out a short plan/);
    // wait before the change lands
    expect(text).toMatch(/wait for confirmation/);
  });

  it('ask-first maps to the ask-on-write permission posture (default)', () => {
    expect(resolvePreset('careful-reviewer').permissionMode).toBe('default');
  });

  it('listPresets() includes careful-reviewer with non-empty title/description', () => {
    const summary = listPresets().find((preset) => preset.id === 'careful-reviewer');
    expect(summary).toBeDefined();
    expect((summary?.title ?? '').length).toBeGreaterThan(0);
    expect((summary?.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('neutral-executor', () => {
  it('autonomy === "balanced"', () => {
    expect(resolvePreset('neutral-executor').autonomy).toBe('balanced');
  });

  it('enableParallelSubagents === false', () => {
    expect(resolvePreset('neutral-executor').enableParallelSubagents).toBe(false);
  });

  it('selfVerification === false', () => {
    expect(resolvePreset('neutral-executor').selfVerification).toBe(false);
  });

  it('effort === "medium"', () => {
    expect(resolvePreset('neutral-executor').effort).toBe('medium');
  });

  it('persona contains literal-instruction-following and minimal-scope phrasing', () => {
    const { persona } = resolvePreset('neutral-executor');
    expect(persona).toBeDefined();
    const text = (persona ?? '').toLowerCase();
    // literal instruction following
    expect(text).toMatch(/follow the system and user instructions literally/);
    // minimal scope — no unrequested expansion
    expect(text).toMatch(/stay strictly in scope|only the change that was requested/);
  });

  it('balanced maps to the standard permission posture (default)', () => {
    expect(resolvePreset('neutral-executor').permissionMode).toBe('default');
  });

  it('listPresets() includes neutral-executor with non-empty title/description', () => {
    const summary = listPresets().find((preset) => preset.id === 'neutral-executor');
    expect(summary).toBeDefined();
    expect((summary?.title ?? '').length).toBeGreaterThan(0);
    expect((summary?.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('resolved options are live-applicable', () => {
  it('a resolvePreset result is assignable to IPresetApplicationOptions', () => {
    const resolved: IResolvedPresetOptions = resolvePreset('careful-reviewer');
    // Structural compat: the framework re-application orchestrator (applyPresetToSession) accepts
    // a resolvePreset result directly — this is what the wiring relies on.
    const applicationOptions: IPresetApplicationOptions = resolved;
    expect(applicationOptions.permissionMode).toBe(resolved.permissionMode);
  });
});

describe('model group is live-applicable', () => {
  it('a resolvePreset result with model/effort/temperature is assignable to the extended IPresetApplicationOptions', () => {
    const resolved: IResolvedPresetOptions = resolvePreset('default', {
      explicit: { model: 'new-model', effort: 'high', temperature: 0.5 },
    });
    // Structural compat: the extended orchestrator option shape accepts the model group
    // (model/effort/temperature/maxOutputTokens) straight from a resolvePreset result.
    const applicationOptions: IPresetApplicationOptions = resolved;
    expect(applicationOptions.model).toBe(resolved.model);
    expect(applicationOptions.effort).toBe(resolved.effort);
    expect(applicationOptions.temperature).toBe(resolved.temperature);
  });
});

describe('persona group is live-applicable', () => {
  it('a resolvePreset result carries persona and is assignable to IPresetApplicationOptions', () => {
    const resolved: IResolvedPresetOptions = resolvePreset('careful-reviewer');
    expect(resolved.persona).toBeDefined();
    // Structural compat: the extended orchestrator option shape accepts the persona
    // group straight from a resolvePreset result.
    const applicationOptions: IPresetApplicationOptions = resolved;
    expect(applicationOptions.persona).toBe(resolved.persona);
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
