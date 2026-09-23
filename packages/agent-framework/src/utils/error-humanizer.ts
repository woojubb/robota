import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ProviderError,
} from '@robota-sdk/agent-core';

/** Product-owned remediation text. The framework never knows command names or settings paths. */
export interface IProviderErrorGuidance {
  readonly authentication?: string;
  readonly forbidden?: string;
  readonly rateLimit?: string;
  readonly network?: string;
}

type TGuidanceCategory = keyof IProviderErrorGuidance;

const HTTP_PATTERNS: Array<{
  pattern: RegExp;
  message: string;
  category?: TGuidanceCategory;
}> = [
  {
    pattern: /\b401\b|invalid.*api.?key|authentication.*fail|unauthorized/i,
    message: 'Invalid API key.',
    category: 'authentication',
  },
  {
    pattern: /\b403\b|permission.*denied|forbidden/i,
    message:
      'Access denied. Your API key may lack permission for this model. Check your provider plan.',
    category: 'forbidden',
  },
  {
    pattern: /\b429\b|rate.?limit|too many requests|quota.*exceeded/i,
    message: 'Rate limit reached. Wait a moment and try again.',
    category: 'rateLimit',
  },
  {
    pattern: /\b500\b|internal server error/i,
    message: 'The AI provider returned an internal error. This is usually temporary — try again.',
  },
  {
    pattern: /\b503\b|service.*unavailable|overloaded/i,
    message:
      'The AI provider is temporarily unavailable or overloaded. Try again in a few seconds.',
  },
  {
    pattern: /\b502\b|bad gateway/i,
    message: 'The AI provider gateway is unreachable. Check your network or try again shortly.',
  },
  {
    pattern: /\btimeout\b|timed.?out|ETIMEDOUT/i,
    message:
      'The request timed out. Check your internet connection, or try a shorter prompt to reduce response time.',
  },
  {
    pattern: /ENOTFOUND|ECONNREFUSED|ECONNRESET|network.*error|fetch.*fail/i,
    message: 'Network connection failed. Check your internet connection.',
    category: 'network',
  },
];

function withGuidance(
  message: string,
  category: TGuidanceCategory,
  guidance?: IProviderErrorGuidance,
): string {
  const hint = guidance?.[category]?.trim();
  return hint ? `${message} ${hint}` : message;
}

/**
 * Maps a raw provider/network error to a user-friendly message with resolution hints.
 * Falls back to the original message if no pattern matches.
 */
export function humanizeApiError(error: Error, guidance?: IProviderErrorGuidance): string {
  if (error instanceof AuthenticationError) {
    return withGuidance('Invalid API key.', 'authentication', guidance);
  }
  if (error instanceof RateLimitError) {
    const hint = error.retryAfter ? ` (retry after ${error.retryAfter}s)` : '';
    return withGuidance(
      `Rate limit reached${hint}. Wait a moment and try again.`,
      'rateLimit',
      guidance,
    );
  }
  if (error instanceof NetworkError) {
    return withGuidance(
      'Network connection failed. Check your internet connection.',
      'network',
      guidance,
    );
  }
  if (error instanceof ProviderError && error.originalError) {
    return humanizeApiError(error.originalError, guidance);
  }

  const msg = error.message;
  for (const { pattern, message, category } of HTTP_PATTERNS) {
    if (pattern.test(msg)) {
      return category ? withGuidance(message, category, guidance) : message;
    }
  }

  return msg;
}
