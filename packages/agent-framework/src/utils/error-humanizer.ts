import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ProviderError,
} from '@robota-sdk/agent-core';

const HTTP_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\b401\b|invalid.*api.?key|authentication.*fail|unauthorized/i,
    message:
      'Invalid API key. Run `/provider` to reconfigure, or check your settings file (~/.robota/settings.json).',
  },
  {
    pattern: /\b403\b|permission.*denied|forbidden/i,
    message:
      'Access denied. Your API key may lack permission for this model. Check your provider plan or run `/provider` to switch accounts.',
  },
  {
    pattern: /\b429\b|rate.?limit|too many requests|quota.*exceeded/i,
    message:
      'Rate limit reached. Wait a moment and try again. Consider switching to a different model with `/model`.',
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
    message:
      'Network connection failed. Check your internet connection and verify your provider URL in settings.',
  },
];

/**
 * Maps a raw provider/network error to a user-friendly message with resolution hints.
 * Falls back to the original message if no pattern matches.
 */
export function humanizeApiError(error: Error): string {
  if (error instanceof AuthenticationError) {
    return 'Invalid API key. Run `/provider` to reconfigure, or check your settings file (~/.robota/settings.json).';
  }
  if (error instanceof RateLimitError) {
    const hint = error.retryAfter ? ` (retry after ${error.retryAfter}s)` : '';
    return `Rate limit reached${hint}. Wait a moment and try again. Consider switching to a different model with \`/model\`.`;
  }
  if (error instanceof NetworkError) {
    return 'Network connection failed. Check your internet connection and verify your provider URL in settings.';
  }
  if (error instanceof ProviderError && error.originalError) {
    return humanizeApiError(error.originalError);
  }

  const msg = error.message;
  for (const { pattern, message } of HTTP_PATTERNS) {
    if (pattern.test(msg)) {
      return message;
    }
  }

  return msg;
}
