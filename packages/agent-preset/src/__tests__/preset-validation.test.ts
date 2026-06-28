import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateExternalPreset } from '../preset-validation.js';
import {
  clearExternalPresets,
  getPreset,
  listPresets,
  registerExternalPresets,
} from '../resolve-preset.js';

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

describe('registerExternalPresets / clearExternalPresets', () => {
  beforeEach(() => clearExternalPresets());
  afterEach(() => clearExternalPresets());

  const external: IPreset = { id: 'ext-1', title: 'Ext One', description: 'external preset' };

  it('registers a fresh external preset and exposes it through the readers', () => {
    const result = registerExternalPresets([external]);
    expect(result.registered).toEqual(['ext-1']);
    expect(result.rejected).toEqual([]);
    expect(getPreset('ext-1')?.title).toBe('Ext One');
    expect(listPresets().some((p) => p.id === 'ext-1')).toBe(true);
  });

  it('rejects an id colliding with a built-in (built-ins win)', () => {
    const result = registerExternalPresets([
      { id: 'default', title: 'Hijack', description: 'nope' },
    ]);
    expect(result.registered).toEqual([]);
    expect(result.rejected).toEqual([{ id: 'default', reason: 'collides with built-in preset' }]);
    expect(getPreset('default')?.title).toBe('Default');
  });

  it('rejects a duplicate external id (first registration wins)', () => {
    registerExternalPresets([external]);
    const result = registerExternalPresets([{ ...external, title: 'Second' }]);
    expect(result.registered).toEqual([]);
    expect(result.rejected).toEqual([{ id: 'ext-1', reason: 'duplicate preset id' }]);
    expect(getPreset('ext-1')?.title).toBe('Ext One');
  });

  it('clearExternalPresets removes externals but leaves the built-ins intact', () => {
    registerExternalPresets([external]);
    clearExternalPresets();
    expect(getPreset('ext-1')).toBeUndefined();
    expect(getPreset('default')?.id).toBe('default');
  });
});
