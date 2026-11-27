import { describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IAIProvider } from '@robota-sdk/agent-core';
import {
  assertCallsAreBounded,
  normalizeEnforcement,
  type CallEnforcement,
  type RuntimeEnforcement,
} from './enforcement';

const valid: RuntimeEnforcement = { providerAttempts: 2, requestOverheadTokens: 10 };

describe('normalizeEnforcement', () => {
  it('keeps the declared numbers and turns the free tools into a set', () => {
    const normalized = normalizeEnforcement({ ...valid, freeTools: ['a', 'b'] });
    expect(normalized.providerAttempts).toBe(2);
    expect(normalized.requestOverheadTokens).toBe(10);
    expect([...normalized.freeTools]).toEqual(['a', 'b']);
    expect(normalizeEnforcement({ ...valid, requestOverheadTokens: 0 }).freeTools.size).toBe(0);
  });

  it.each([
    ['no attempts', { requestOverheadTokens: 0 }],
    ['zero attempts', { providerAttempts: 0, requestOverheadTokens: 0 }],
    ['fractional attempts', { providerAttempts: 1.5, requestOverheadTokens: 0 }],
    ['unsafe attempts', { providerAttempts: 2 ** 60, requestOverheadTokens: 0 }],
    ['no overhead', { providerAttempts: 1 }],
    ['negative overhead', { providerAttempts: 1, requestOverheadTokens: -1 }],
    ['fractional overhead', { providerAttempts: 1, requestOverheadTokens: 0.5 }],
    ['NaN overhead', { providerAttempts: 1, requestOverheadTokens: Number.NaN }],
    ['a repeated free tool', { ...valid, freeTools: ['a', 'a'] }],
    ['an empty free tool name', { ...valid, freeTools: [''] }],
    ['a non-string free tool', { ...valid, freeTools: [1] }],
    ['free tools that are not a list', { ...valid, freeTools: 'a' }],
  ])('refuses %s with invalid-config and defaults nothing', (_label, value) => {
    expect(() => normalizeEnforcement(value as unknown as RuntimeEnforcement)).toThrow(
      expect.objectContaining({ code: 'invalid-config' }),
    );
  });

  it('refuses a declaration that is not an object', () => {
    expect(() => normalizeEnforcement(undefined as unknown as RuntimeEnforcement)).toThrow(
      expect.objectContaining({ code: 'invalid-config' }),
    );
  });
});

describe('assertCallsAreBounded', () => {
  const enforcement: CallEnforcement = normalizeEnforcement({ ...valid, freeTools: ['free'] });
  const provider = createScriptedProvider([]).provider;

  function surface(overrides: Partial<Parameters<typeof assertCallsAreBounded>[0]> = {}) {
    return {
      providers: [provider],
      outputCap: 64,
      outputCapField: 'maxOutputTokens',
      toolNames: ['free'],
      enforcement,
      ...overrides,
    };
  }

  it('accepts a positive cap, free tools and a provider without hosted web tools', () => {
    expect(() => assertCallsAreBounded(surface())).not.toThrow();
  });

  it.each([undefined, 0, -1, 1.5])('refuses an output cap of %s and names the field', (cap) => {
    expect(() => assertCallsAreBounded(surface({ outputCap: cap }))).toThrow(
      expect.objectContaining({
        code: 'unbounded-call',
        message: expect.stringContaining('maxOutputTokens'),
      }),
    );
  });

  it('refuses a Session that may compact on its own', () => {
    expect(() => assertCallsAreBounded(surface({ automaticCompaction: true }))).toThrow(
      expect.objectContaining({
        code: 'unbounded-call',
        message: expect.stringContaining('compaction'),
      }),
    );
    expect(() => assertCallsAreBounded(surface({ automaticCompaction: false }))).not.toThrow();
  });

  it('refuses a provider with hosted web tools enabled, and one whose capability check throws', () => {
    const hosted = Object.assign({}, provider, {
      getCapabilities: () => ({
        functionCalling: { supported: true },
        nativeWebTools: {
          webSearch: { supported: true, enabled: true },
          webFetch: { supported: false, enabled: false },
        },
      }),
    }) as IAIProvider;
    const throwing = Object.assign({}, provider, {
      getCapabilities: () => {
        throw new Error('no capabilities');
      },
    }) as IAIProvider;
    for (const bad of [hosted, throwing])
      expect(() => assertCallsAreBounded(surface({ providers: [bad] }))).toThrow(
        expect.objectContaining({
          code: 'unbounded-call',
          message: expect.stringContaining('web'),
        }),
      );
  });

  it('refuses a tool declared in no list and names it', () => {
    expect(() => assertCallsAreBounded(surface({ toolNames: ['free', 'mystery'] }))).toThrow(
      expect.objectContaining({
        code: 'unbounded-call',
        message: 'An enforced runtime must declare every tool free or paid: mystery',
      }),
    );
  });
});
