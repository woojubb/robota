import { describe, it, expect } from 'vitest';

import {
  resolveRoleModel,
  resolveRoleFallbackChain,
  runWithRoleFallback,
} from '../role-model-routing.js';

import type { TRoleModelMap, TModelRef } from '@robota-sdk/agent-core';

/**
 * SELFHOST-006 TC-01 / TC-02 — per-role model routing policy over the provider DIP.
 *
 * TC-01: resolve distinct OPAQUE role keys to their configured fallback chains' primaries.
 * TC-02: on a provider error, walk to the next TModelRef (alternate provider AND model) and succeed.
 */

const MAP: TRoleModelMap = {
  // opaque string keys — no enum, no fixed union
  planner: [
    { provider: 'anthropic', model: 'claude-opus-4-5' },
    { provider: 'openai', model: 'o3' },
  ],
  editor: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
};

describe('SELFHOST-006 TC-01 — resolve per opaque role key', () => {
  it('resolves two distinct role keys to their chains’ primary TModelRef', () => {
    expect(resolveRoleModel(MAP, 'planner')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-5',
    });
    expect(resolveRoleModel(MAP, 'editor')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
  });

  it('returns undefined for an unmapped role (opaque key, not a fixed vocabulary)', () => {
    expect(resolveRoleModel(MAP, 'whatever-custom-role')).toBeUndefined();
  });

  it('exposes the full ordered fallback chain', () => {
    expect(resolveRoleFallbackChain(MAP, 'planner').map((r) => r.provider)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(resolveRoleFallbackChain(MAP, 'missing')).toEqual([]);
  });
});

describe('SELFHOST-006 TC-02 — fallback walk on provider error', () => {
  it('walks to the next provider+model on error and succeeds', async () => {
    const tried: TModelRef[] = [];
    const result = await runWithRoleFallback(MAP.planner!, async (ref) => {
      tried.push(ref);
      if (ref.provider === 'anthropic') throw new Error('provider 5xx');
      return `ran on ${ref.provider}:${ref.model}`;
    });
    expect(result).toBe('ran on openai:o3');
    // proves it tried the primary FIRST, then the alternate PROVIDER + MODEL
    expect(tried).toEqual([
      { provider: 'anthropic', model: 'claude-opus-4-5' },
      { provider: 'openai', model: 'o3' },
    ]);
  });

  it('returns the primary result without trying fallbacks when it succeeds', async () => {
    let calls = 0;
    const result = await runWithRoleFallback(MAP.planner!, async (ref) => {
      calls += 1;
      return ref.model;
    });
    expect(result).toBe('claude-opus-4-5');
    expect(calls).toBe(1);
  });

  it('throws the LAST error when the whole chain is exhausted', async () => {
    await expect(
      runWithRoleFallback(MAP.planner!, async (ref) => {
        throw new Error(`down: ${ref.provider}`);
      }),
    ).rejects.toThrow('down: openai');
  });

  it('throws immediately on an empty chain', async () => {
    await expect(runWithRoleFallback([], async () => 'x')).rejects.toThrow(/empty fallback chain/);
  });
});
