import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TJson } from './outcome-coding-protocol.js';
import {
  basisCovers,
  maxCallCostMicros,
  parseEndpointListing,
  parseMicros,
  parseRate,
  parseReceipt,
  tokenCostMicros,
} from './outcome-coding-pricing.js';

test('decimal prices convert exactly and always round up', () => {
  assert.equal(parseRate('0.000003'), 3_000_000);
  assert.equal(parseRate(3e-7), 300_000);
  assert.equal(parseRate('0.0000000000011'), 2);
  assert.equal(parseMicros('0.000001'), 1);
  assert.equal(parseMicros('0.0000011'), 2);
  assert.equal(parseMicros(0), 0);
  assert.equal(parseMicros('2'), 2_000_000);
  for (const bad of ['', 'abc', '-1', '1,5', undefined, null, Number.NaN, {}]) {
    assert.equal(parseRate(bad), undefined, String(bad));
    assert.equal(parseMicros(bad), undefined, String(bad));
  }
});

test('token cost rounds up and the call bound adds the template allowance and the output cap', () => {
  assert.equal(tokenCostMicros(1, 1), 1);
  assert.equal(tokenCostMicros(1_000_000, 3_000_000), 3_000_000);
  const rates = {
    promptMicrosPerMillionTokens: 3_000_000,
    completionMicrosPerMillionTokens: 15_000_000,
  };
  const bound = maxCallCostMicros(rates, {
    requestBytes: 8_000,
    templateAllowanceTokens: 2_000,
    maxOutputTokens: 8_192,
  });
  assert.equal(bound, 30_000 + 122_880);
});

function listing(entries: TJson[]): TJson {
  return { data: { endpoints: entries } };
}

test('the basis comes from the highest price across the pinned provider regions, not the headline', () => {
  const parsed = parseEndpointListing(
    listing([
      { provider_name: 'route-a', pricing: { prompt: '0.000001', completion: '0.000004' } },
      {
        provider_name: 'route-a',
        pricing: { prompt: '0.000001', completion: '0.000004' },
        regions: [
          { pricing: { prompt: '0.0000015', completion: '0.000003' } },
          { pricing: { prompt: '0.000002', completion: '0.000005' } },
        ],
      },
      { provider_name: 'route-b', pricing: { prompt: '0.01', completion: '0.01' } },
    ]),
    'route-a',
  );
  assert.deepEqual(parsed.rates, {
    promptMicrosPerMillionTokens: 2_000_000,
    completionMicrosPerMillionTokens: 5_000_000,
  });
  assert.equal(parsed.pricedEntries, 4);
  assert.equal(basisCovers(parsed.rates, parsed.rates), true);
  assert.equal(
    basisCovers({ ...parsed.rates, completionMicrosPerMillionTokens: 4_999_999 }, parsed.rates),
    false,
  );
});

test('a listing without the provider, without prices or with a malformed price is refused', () => {
  assert.throws(() => parseEndpointListing(listing([]), 'route-a'), /does not include/);
  assert.throws(() => parseEndpointListing({}, 'route-a'), /no endpoints/);
  assert.throws(
    () => parseEndpointListing(listing([{ provider_name: 'route-a' }]), 'route-a'),
    /no priced entry/,
  );
  assert.throws(
    () =>
      parseEndpointListing(
        listing([{ provider_name: 'route-a', pricing: { prompt: 'free', completion: '0.1' } }]),
        'route-a',
      ),
    /malformed/,
  );
});

test('a receipt never reads a missing or malformed field as zero', () => {
  const reply = {
    model: 'm',
    provider: 'ignored-reply-field',
    usage: { cost: 0.0000123, prompt_tokens: 10, completion_tokens: 5 },
  };
  assert.deepEqual(parseReceipt(reply), {
    costMicros: 13,
    promptTokens: 10,
    outputTokens: 5,
    provider: undefined,
    model: 'm',
    generationModel: undefined,
  });
  const record = { provider_name: 'route-a', model: 'm2', total_cost: 0.00002 };
  assert.deepEqual(parseReceipt(reply, record), {
    costMicros: 20,
    promptTokens: 10,
    outputTokens: 5,
    provider: 'route-a',
    model: 'm',
    generationModel: 'm2',
  });
  // The larger cost wins in either direction; one readable cost stands alone.
  assert.equal(parseReceipt(reply, { total_cost: 0.000001 }).costMicros, 13);
  assert.equal(parseReceipt({ usage: {} }, { total_cost: 0.000004 }).costMicros, 4);
  assert.equal(parseReceipt({ usage: {} }, { total_cost: 'free' }).costMicros, undefined);
  const empty = parseReceipt({ usage: { cost: 'free', completion_tokens: -1 } });
  assert.equal(empty.costMicros, undefined);
  assert.equal(empty.outputTokens, undefined);
  assert.equal(parseReceipt(null).costMicros, undefined);
  assert.equal(parseReceipt({ usage: { cost: 0 } }).costMicros, 0);
});
