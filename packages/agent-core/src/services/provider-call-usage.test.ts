import { describe, expect, it } from 'vitest';

import { verifiedProviderCallUsage } from './provider-call-usage';

import type { TUniversalMessage } from '../interfaces/messages';

function message(metadata: Record<string, string | number>, usage?: Record<string, number>): TUniversalMessage {
  return { id: 'message', role: 'assistant', content: 'private response', state: 'complete', timestamp: new Date(), metadata, ...(usage && { usage }) } as TUniversalMessage;
}

describe('provider-reported usage verification', () => {
  it('accepts a complete attested zero only when both counters and consistent total are present', () => {
    expect(verifiedProviderCallUsage(message({ usageProvenance: 'complete' }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }))).toEqual({
      provenance: 'complete', promptTokens: 0, completionTokens: 0, totalTokens: 0,
    });
  });

  it.each([
    [{ usageProvenance: 'complete' }, { promptTokens: 1, completionTokens: 2, totalTokens: 4 }],
    [{ usageProvenance: 'complete' }, { promptTokens: -1, completionTokens: 2, totalTokens: 1 }],
    [{ usageProvenance: 'complete' }, { promptTokens: 1.5, completionTokens: 2, totalTokens: 3.5 }],
    [{ usageProvenance: 'complete' }, { promptTokens: 1, completionTokens: Number.MAX_SAFE_INTEGER, totalTokens: Number.MAX_SAFE_INTEGER }],
  ] as const)('rejects inconsistent or unsafe complete counts', (metadata, usage) => {
    expect(verifiedProviderCallUsage(message(metadata, usage))).toEqual({ provenance: 'absent' });
  });

  it('never treats defaulted or partial counters as complete', () => {
    expect(verifiedProviderCallUsage(message({}, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }))).toEqual({ provenance: 'absent' });
    expect(verifiedProviderCallUsage(message({ usageProvenance: 'partial' }, { promptTokens: 1, completionTokens: 0, totalTokens: 1 }))).toEqual({ provenance: 'partial' });
  });

  it('carries an attested cache read that is part of the prompt, and drops one that is not', () => {
    expect(verifiedProviderCallUsage(message({ usageProvenance: 'complete' }, { promptTokens: 1000, completionTokens: 20, totalTokens: 1020, cacheReadTokens: 800 }))).toEqual({
      provenance: 'complete', promptTokens: 1000, completionTokens: 20, totalTokens: 1020, cacheReadTokens: 800,
    });
    expect(verifiedProviderCallUsage(message({ usageProvenance: 'complete' }, { promptTokens: 10, completionTokens: 2, totalTokens: 12, cacheReadTokens: 11 }))).toEqual({
      provenance: 'complete', promptTokens: 10, completionTokens: 2, totalTokens: 12,
    });
  });
});
