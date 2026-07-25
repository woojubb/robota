import { describe, expect, it } from 'vitest';

import { createPresetRegistry, getPreset, resolvePreset } from '../resolve-preset.js';

import type { IPreset } from '../preset-types.js';

/**
 * ARCH-005 S1 (R8) — the per-call, instance-scoped preset registry. `createPresetRegistry(presets)`
 * builds an isolated resolver over `[built-ins, ...presets]` WITHOUT touching agent-preset's module-level
 * `externalPresets` global, so two products in one process do not share one registry and repeat calls do
 * not accumulate / cross-contaminate.
 */

const acmeReviewer: IPreset = {
  id: 'acme-reviewer',
  title: 'Acme Reviewer',
  description: 'strict review persona',
  persona: 'You are a meticulous code reviewer.',
  autonomy: 'ask-first',
};

describe('createPresetRegistry — instance-scoped resolution', () => {
  it('resolves an instance-scoped external preset the module-global registry does not know', () => {
    const registry = createPresetRegistry([acmeReviewer]);

    const resolved = registry.resolvePreset('acme-reviewer');
    expect(resolved.persona).toBe('You are a meticulous code reviewer.');
    // ask-first autonomy maps onto a permission posture (same derivation as the global resolver).
    expect(resolved.permissionMode).toBeDefined();

    // The registry sees built-ins too.
    expect(registry.getPreset('default')).toBeDefined();
    expect(registry.listPresets().map((p) => p.id)).toContain('acme-reviewer');
    expect(registry.listPresets().map((p) => p.id)).toContain('default');
  });

  it('does NOT mutate the module-level global registry (R8 — no cross-contamination)', () => {
    createPresetRegistry([acmeReviewer]);

    // The global resolver must be untouched by the instance-scoped registration.
    expect(getPreset('acme-reviewer')).toBeUndefined();
    expect(() => resolvePreset('acme-reviewer')).toThrow(/Unknown preset/);
  });

  it('two registries are isolated from each other', () => {
    const other: IPreset = { id: 'acme-builder', title: 'B', description: 'd', persona: 'build' };
    const a = createPresetRegistry([acmeReviewer]);
    const b = createPresetRegistry([other]);

    expect(a.getPreset('acme-reviewer')).toBeDefined();
    expect(a.getPreset('acme-builder')).toBeUndefined();
    expect(b.getPreset('acme-builder')).toBeDefined();
    expect(b.getPreset('acme-reviewer')).toBeUndefined();
  });

  it('built-ins win and duplicate external ids are dropped (first registration wins)', () => {
    const shadowDefault: IPreset = { id: 'default', title: 'X', description: 'y', persona: 'nope' };
    const dupA: IPreset = { id: 'dup', title: 'A', description: 'a', persona: 'first' };
    const dupB: IPreset = { id: 'dup', title: 'B', description: 'b', persona: 'second' };

    const registry = createPresetRegistry([shadowDefault, dupA, dupB]);

    // Built-in 'default' is a no-op preset; the shadow's persona must NOT leak in.
    expect(registry.resolvePreset('default').persona).toBeUndefined();
    // First 'dup' wins.
    expect(registry.resolvePreset('dup').persona).toBe('first');
  });
});
