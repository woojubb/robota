/** Provider-agnostic LLM error classification + message sanitization for the collapsed llm-text node. */

const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9\-_]{10,}|[A-Za-z0-9]{32,})\b/g;

const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

export function sanitizeErrorMessage(message: string): string {
  return message.replace(API_KEY_PATTERN, '[REDACTED]');
}

export type TLlmErrorCode =
  | 'MISSING_API_KEY'
  | 'RATE_LIMITED'
  | 'CONTEXT_TOO_LONG'
  | 'BILLING_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

/** Classify a thrown provider error into a stable code + retryability, from HTTP status and/or message. */
export function classifyLlmError(error: unknown): { code: TLlmErrorCode; retryable: boolean } {
  const status =
    (error as { status?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  const message = ((error as { message?: string })?.message ?? '').toLowerCase();

  if (
    status === HTTP_UNAUTHORIZED ||
    message.includes('authentication') ||
    message.includes('api_key') ||
    message.includes('invalid key')
  ) {
    return { code: 'MISSING_API_KEY', retryable: false };
  }
  if (
    status === HTTP_TOO_MANY_REQUESTS ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return { code: 'RATE_LIMITED', retryable: true };
  }
  if (
    message.includes('context_length_exceeded') ||
    message.includes('too long') ||
    message.includes('maximum context')
  ) {
    return { code: 'CONTEXT_TOO_LONG', retryable: false };
  }
  if (
    status === HTTP_PAYMENT_REQUIRED ||
    message.includes('billing') ||
    message.includes('quota')
  ) {
    return { code: 'BILLING_ERROR', retryable: false };
  }
  if (status !== undefined && status >= HTTP_SERVER_ERROR_MIN) {
    return { code: 'SERVER_ERROR', retryable: true };
  }
  return { code: 'UNKNOWN', retryable: false };
}
