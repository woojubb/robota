import { expect, it } from 'vitest';
import { createHostedOrganizationModelAction } from '../hosted-organization-model.js';

it('refuses installing a model effect without a trusted input-token bound', () => {
  expect(() => createHostedOrganizationModelAction({
    payloads: {}, endpoint: 'https://provider.example/v1', apiKey: 'owner-key', model: 'pinned-model',
    roles: ['operator'], resource: 'model', reservation: { tokens: 10, timeMs: 1000, costMicros: 10 },
    maxInputBytes: 1000, maxOutputTokens: 8, costMicrosPerToken: 1, providerIdempotency: false,
  } as never)).toThrow(/invalid-schema/u);
});

const priceOptions = (costMicrosPerToken: number) => ({
  payloads: {}, endpoint: 'https://provider.example/v1', apiKey: 'owner-key', model: 'pinned-model',
  roles: ['operator'], resource: 'model', reservation: { tokens: 10, timeMs: 1000, costMicros: 10 },
  maxInputBytes: 1000, maxOutputTokens: 8, costMicrosPerToken, providerIdempotency: false,
  countInputTokens: async () => 1,
} as never);

it('refuses a zero price so an unpriced provider call is never treated as free', () => {
  expect(() => createHostedOrganizationModelAction(priceOptions(0))).toThrow(/invalid-schema/u);
});

it('accepts the smallest positive price', () => {
  expect(() => createHostedOrganizationModelAction(priceOptions(1))).not.toThrow();
});
