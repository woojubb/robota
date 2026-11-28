/**
 * Money arithmetic and price handling for the spend ledger. Everything is integer micro-dollars
 * (one millionth of a dollar); rates are micro-dollars per million tokens, which equals the
 * dollars-per-token price times 1e12. Decimal text from a gateway is converted exactly and always
 * rounded up, so no conversion can make a bound smaller than the price it came from.
 */

import type { TJson, TJsonObject } from './outcome-coding-protocol.js';

export interface IRates {
  /** Micro-dollars per million input tokens. */
  readonly promptMicrosPerMillionTokens: number;
  /** Micro-dollars per million output tokens. */
  readonly completionMicrosPerMillionTokens: number;
}

const MILLION = 1_000_000n;
const DECIMAL = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Exact decimal text (or a number's shortest text) times 10^scale, rounded up; `undefined` if malformed. */
function scaleUp(value: unknown, scale: number, down = false): bigint | undefined {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (typeof text !== 'string') return undefined;
  const match = DECIMAL.exec(text.trim());
  if (match === null) return undefined;
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0') + scale - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 60) return undefined;
  const digits = BigInt(`${match[1]}${fraction}`);
  if (exponent >= 0) return digits * 10n ** BigInt(exponent);
  const divisor = 10n ** BigInt(-exponent);
  return down ? digits / divisor : (digits + divisor - 1n) / divisor;
}

function toSafeNumber(value: bigint | undefined): number | undefined {
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}

/** A dollars-per-token price as micro-dollars per million tokens; `undefined` when malformed. */
export function parseRate(usdPerToken: unknown): number | undefined {
  return toSafeNumber(scaleUp(usdPerToken, 12));
}

/** A dollar amount as whole micro-dollars, rounded up unless `down` is asked; `undefined` when malformed or negative. */
export function parseMicros(usd: unknown, round: 'up' | 'down' = 'up'): number | undefined {
  return toSafeNumber(scaleUp(usd, 6, round === 'down'));
}

/** Micro-dollars for a token count at a rate, rounded up. */
export function tokenCostMicros(tokens: number, microsPerMillionTokens: number): number {
  const product = BigInt(tokens) * BigInt(microsPerMillionTokens);
  return Number((product + MILLION - 1n) / MILLION);
}

export interface ICallBound {
  /** Bytes of the request body exactly as sent upstream. */
  readonly requestBytes: number;
  /** Tokens added once per request for the provider's own templates around the messages. */
  readonly templateAllowanceTokens: number;
  /** The output cap the request carries. */
  readonly maxOutputTokens: number;
}

/**
 * The most one call can cost at the given rates. A token covers at least one byte of the text, so
 * the encoded bytes bound the input tokens; the allowance covers what the provider wraps around
 * them. Output, reasoning included, is bounded by the output cap.
 */
export function maxCallCostMicros(rates: IRates, call: ICallBound): number {
  return (
    tokenCostMicros(
      call.requestBytes + call.templateAllowanceTokens,
      rates.promptMicrosPerMillionTokens,
    ) + tokenCostMicros(call.maxOutputTokens, rates.completionMicrosPerMillionTokens)
  );
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectPricing(entry: unknown, into: { readonly [key: string]: unknown }[]): void {
  if (!isObject(entry)) return;
  if (isObject(entry.pricing)) into.push(entry.pricing);
  if (Array.isArray(entry.regions))
    for (const region of entry.regions) collectPricing(region, into);
}

export interface IEndpointListing {
  /** The highest price of each kind across every region the pinned provider serves. */
  readonly rates: IRates;
  /** How many priced region entries the maximum was taken over. */
  readonly pricedEntries: number;
}

/**
 * Reads the pinned route's prices from an endpoint listing: `data.endpoints[]`, each with a
 * `provider_name` and `pricing.prompt` / `pricing.completion` in dollars per token, possibly with
 * nested `regions[]` carrying their own pricing. The result is the highest price of each kind over
 * every entry of the pinned provider, not the model's headline price. A malformed price, a missing
 * provider or an entry without both prices refuses: a bound is never guessed.
 */
export function parseEndpointListing(body: TJson | undefined, provider: string): IEndpointListing {
  const data = isObject(body) ? body.data : undefined;
  const endpoints = isObject(data) && Array.isArray(data.endpoints) ? data.endpoints : undefined;
  if (endpoints === undefined) throw new Error('The endpoint listing has no endpoints list');
  const pricings: { readonly [key: string]: unknown }[] = [];
  let seen = 0;
  for (const endpoint of endpoints) {
    if (!isObject(endpoint) || endpoint.provider_name !== provider) continue;
    seen += 1;
    collectPricing(endpoint, pricings);
  }
  if (seen === 0) throw new Error('The endpoint listing does not include the pinned provider');
  if (pricings.length === 0) throw new Error('The pinned provider has no priced entry');
  let prompt = 0;
  let completion = 0;
  for (const pricing of pricings) {
    const promptRate = parseRate(pricing.prompt);
    const completionRate = parseRate(pricing.completion);
    if (promptRate === undefined || completionRate === undefined) {
      throw new Error('A priced entry has a missing or malformed price');
    }
    prompt = Math.max(prompt, promptRate);
    completion = Math.max(completion, completionRate);
  }
  return {
    rates: { promptMicrosPerMillionTokens: prompt, completionMicrosPerMillionTokens: completion },
    pricedEntries: pricings.length,
  };
}

/** True when the basis is at or above the listing's highest price for both kinds. */
export function basisCovers(basis: IRates, listed: IRates): boolean {
  return (
    basis.promptMicrosPerMillionTokens >= listed.promptMicrosPerMillionTokens &&
    basis.completionMicrosPerMillionTokens >= listed.completionMicrosPerMillionTokens
  );
}

export interface IReceipt {
  readonly costMicros: number | undefined;
  readonly promptTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  /** The model the gateway's generation record names. */
  readonly generationModel: string | undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The receipt of one call: the token counts and `usage.cost` (dollars) from the completion reply,
 * and the serving provider, model and billed `total_cost` from the gateway's generation record,
 * because the reply itself does not name the provider. The cost is the larger of the two readable
 * costs, so it is never understated. A field that is absent or malformed is `undefined`, never a
 * default, so a missing receipt cannot read as zero cost.
 */
export function parseReceipt(body: TJson | undefined, generation?: TJsonObject): IReceipt {
  const usage = isObject(body) && isObject(body.usage) ? body.usage : undefined;
  const replyCost = usage === undefined ? undefined : parseMicros(usage.cost);
  const recordCost = generation === undefined ? undefined : parseMicros(generation.total_cost);
  const costs = [replyCost, recordCost].filter((cost): cost is number => cost !== undefined);
  return {
    costMicros: costs.length === 0 ? undefined : Math.max(...costs),
    promptTokens: count(usage?.prompt_tokens),
    outputTokens: count(usage?.completion_tokens),
    provider: typeof generation?.provider_name === 'string' ? generation.provider_name : undefined,
    model: isObject(body) && typeof body.model === 'string' ? body.model : undefined,
    generationModel: typeof generation?.model === 'string' ? generation.model : undefined,
  };
}
