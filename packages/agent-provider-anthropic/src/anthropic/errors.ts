/**
 * Mapping Anthropic's HTTP errors onto the shared error taxonomy.
 *
 * The 429 mapping existed twice — once on the non-streaming path and once on the streaming one —
 * character for character. Two copies of a taxonomy decision is how the two paths end up classifying
 * the same failure differently the first time one of them is edited; PROV-004 already records error
 * taxonomy drifting across provider surfaces as a defect.
 */

import { RateLimitError } from '@robota-sdk/agent-core';

const HTTP_TOO_MANY_REQUESTS = 429;

/** The shape of an Anthropic SDK HTTP error, narrowed from `unknown`. */
interface IAnthropicHttpError {
  status?: number;
  error?: { type?: string };
  message?: string;
}

/**
 * Re-throw an Anthropic SDK error, as a `RateLimitError` when that is what it is.
 *
 * Always throws — the return type says so, so a caller cannot fall through it by accident.
 */
export function rethrowAnthropicError(error: unknown): never {
  // allow-fallback: re-throws the original after mapping 429 to RateLimitError
  // allow-any: narrowing an unknown HTTP error shape from the Anthropic SDK
  const anthropicError = error as IAnthropicHttpError;
  if (
    anthropicError.status === HTTP_TOO_MANY_REQUESTS ||
    anthropicError.error?.type === 'rate_limit_error'
  ) {
    throw new RateLimitError(
      anthropicError.message ?? 'Anthropic rate limit exceeded.',
      undefined,
      'anthropic',
    );
  }
  throw error;
}
