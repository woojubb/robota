import { describe, expect, it } from 'vitest';

import { validateExternalPreset } from '../preset-validation.js';
import { createPresetRegistry, partitionExternalPresets } from '../resolve-preset.js';

import type { IPreset } from '../preset-types.js';

const BASE = { id: 'p', title: 'P', description: 'd' };

describe('validateExternalPreset — field-type validation', () => {
  it('rejects a non-object input', () => {
    const result = validateExternalPreset('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/non-null object/);
  });

  it('rejects an empty required string', () => {
    const result = validateExternalPreset({ ...BASE, id: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^id: /);
  });

  it('accepts and assigns recognised string fields', () => {
    const result = validateExternalPreset({ ...BASE, persona: 'be concise', model: 'm-1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.persona).toBe('be concise');
      expect(result.preset.model).toBe('m-1');
    }
  });

  it('rejects a non-string string field', () => {
    const result = validateExternalPreset({ ...BASE, persona: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('persona: expected a string');
  });

  it('rejects a NaN / non-number scalar field', () => {
    expect(validateExternalPreset({ ...BASE, temperature: 'hot' }).ok).toBe(false);
    const nan = validateExternalPreset({ ...BASE, temperature: Number.NaN });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.error).toBe('temperature: expected a number');
  });

  it('rejects a non-boolean boolean field', () => {
    const result = validateExternalPreset({ ...BASE, selfVerification: 'yes' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('selfVerification: expected a boolean');
  });

  it('accepts valid enum fields and rejects out-of-set values', () => {
    expect(validateExternalPreset({ ...BASE, autonomy: 'act-first' }).ok).toBe(true);
    const bad = validateExternalPreset({ ...BASE, permissionMode: 'sudo' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^permissionMode: expected one of/);
  });

  it('accepts string-array fields and rejects non-string-array values', () => {
    const good = validateExternalPreset({ ...BASE, allowedTools: ['Read', 'Write'] });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.preset.allowedTools).toEqual(['Read', 'Write']);

    const bad = validateExternalPreset({ ...BASE, deniedTools: ['ok', 7] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('deniedTools: expected an array of strings');
  });
});

// ARCH-009 replaced `registerExternalPresets`/`clearExternalPresets` with `partitionExternalPresets`,
// a pure application of the same conflict policy to one list. The cases below assert the policy, which
// is what they always asserted; what is gone is the setup and teardown that existed only because the
// list was the process's. No `beforeEach` clear is needed when nothing is shared.
describe('partitionExternalPresets', () => {
  const external: IPreset = { id: 'ext-1', title: 'Ext One', description: 'external preset' };

  it('accepts a fresh external preset and exposes it through a registry over it', () => {
    const result = partitionExternalPresets([external]);
    expect(result.accepted.map((preset) => preset.id)).toEqual(['ext-1']);
    expect(result.rejected).toEqual([]);

    const registry = createPresetRegistry([external]);
    expect(registry.getPreset('ext-1')?.title).toBe('Ext One');
    expect(registry.listPresets().some((p) => p.id === 'ext-1')).toBe(true);
  });

  it('rejects an id colliding with a built-in (built-ins win)', () => {
    const result = partitionExternalPresets([
      { id: 'default', title: 'Hijack', description: 'nope' },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ id: 'default', reason: 'collides with built-in preset' }]);
    expect(
      createPresetRegistry([{ id: 'default', title: 'Hijack', description: 'nope' }]).getPreset(
        'default',
      )?.title,
    ).toBe('Default');
  });

  it('rejects a duplicate external id (the first one wins)', () => {
    const result = partitionExternalPresets([external, { ...external, title: 'Second' }]);
    expect(result.accepted.map((preset) => preset.title)).toEqual(['Ext One']);
    expect(result.rejected).toEqual([{ id: 'ext-1', reason: 'duplicate preset id' }]);
  });

  it('a registry built without that preset does not carry it, and keeps the built-ins', () => {
    // The property `clearExternalPresets` used to provide, without anything to clear: isolation is
    // what a registry IS now, so a fresh one starts at the built-ins by construction.
    createPresetRegistry([external]);
    const fresh = createPresetRegistry();
    expect(fresh.getPreset('ext-1')).toBeUndefined();
    expect(fresh.getPreset('default')?.id).toBe('default');
  });
});
