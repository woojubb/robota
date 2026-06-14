import { describe, expect, it } from 'vitest';

import { getPreset, listPresets, resolvePreset } from '../resolve-preset.js';

import type { TResolvedPresetOptions } from '../preset-types.js';

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
      'Unknown preset: "does-not-exist". Available presets: default.',
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

describe('getPreset', () => {
  it('returns the default preset by id', () => {
    expect(getPreset('default')?.id).toBe('default');
  });

  it('returns undefined for an unknown id', () => {
    expect(getPreset('missing')).toBeUndefined();
  });
});
