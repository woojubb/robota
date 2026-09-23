import { describe, expect, it } from 'vitest';

import { createModelEffortOutcome, resolveModelEffort } from '../model-effort-capability.js';

describe('resolveModelEffort', () => {
  const table = {
    verifiedAt: '2026-09-11',
    sourceUrl: 'https://provider.example/model-effort',
    models: {
      'verified-model': {
        supportedEfforts: ['minimal', 'low', 'high'] as const,
        defaultEffort: 'low' as const,
        nativeControlId: 'responses.reasoning.effort',
      },
    },
  };

  it('returns the requested tier when the adapter-owned model table documents it', () => {
    expect(resolveModelEffort(table, 'verified-model', 'high')).toEqual({
      selection: 'high',
      effective: 'high',
      disposition: 'exact',
      fingerprint: 'verified-model|high|high|exact|responses.reasoning.effort|2026-09-11',
    });
  });

  it('selects only a documented downward substitute and preserves provider default selection', () => {
    expect(resolveModelEffort(table, 'verified-model', 'max')).toEqual({
      selection: 'max',
      effective: 'high',
      disposition: 'clamped',
      fingerprint: 'verified-model|max|high|clamped|responses.reasoning.effort|2026-09-11',
    });
    expect(resolveModelEffort(table, 'verified-model', 'auto')).toEqual({
      selection: 'auto',
      effective: 'low',
      disposition: 'model-default',
      fingerprint: 'verified-model|auto|low|model-default|responses.reasoning.effort|2026-09-11',
    });
  });

  it('does not invent an outcome for an undeclared model or an upward-only request', () => {
    expect(resolveModelEffort(table, 'missing-model', 'high')).toEqual({
      selection: 'high',
      effective: null,
      disposition: 'not-applied',
      fingerprint: 'missing-model|high|not-applied',
    });
    expect(resolveModelEffort(table, 'verified-model', 'none')).toEqual({
      selection: 'none',
      effective: null,
      disposition: 'not-applied',
      fingerprint: 'verified-model|none|not-applied',
    });
  });

  it('keeps resolution, native-control, and dispatch facts distinct in one serializable outcome', () => {
    const resolution = resolveModelEffort(table, 'verified-model', 'auto');

    expect(
      createModelEffortOutcome(resolution, {
        nativeControl: { state: 'omitted', reason: 'provider-default-selection' },
        providerDispatch: { state: 'sent' },
      }),
    ).toEqual({
      resolution,
      nativeControl: { state: 'omitted', reason: 'provider-default-selection' },
      providerDispatch: { state: 'sent' },
    });
  });
});
