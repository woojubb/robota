/**
 * HTTP hook executor — POSTs hook input as JSON to a URL.
 *
 * Response format: `{ ok: boolean, reason?: string }`, decoded by `decodeHookVerdict` (SEC-015):
 * - `ok: true`  → `allow`
 * - `ok: false` → `deny`, carrying `reason`
 * - anything else, including a non-boolean `ok` → `error` / `malformed-response`
 *
 * Transport conditions are outcomes in their own right rather than a shared failure code:
 * non-2xx → `http-status`, deadline elapsed → `timeout`, unreachable → `transport-failure`,
 * unparseable body → `malformed-response`.
 *
 * Supports env var interpolation in headers: $VAR_NAME
 */

import { decodeHookVerdict } from '../verdict-decoder.js';

import type { IHttpHookDefinition, IHookInput, THookOutcome, IHookTypeExecutor } from '../types.js';

/** Default timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 10;

/** Interpolate $VAR_NAME references in a string with process.env values. */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    return envValue !== undefined ? envValue : _match;
  });
}

export class HttpExecutor implements IHookTypeExecutor {
  readonly type = 'http' as const;

  async execute(definition: IHttpHookDefinition, input: IHookInput): Promise<THookOutcome> {
    const timeoutSeconds = definition.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (definition.headers) {
      for (const [key, value] of Object.entries(definition.headers)) {
        headers[key] = interpolateEnvVars(value);
      }
    }

    try {
      const response = await fetch(definition.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return {
          outcome: 'error',
          source: 'http',
          kind: 'http-status',
          reason: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      // Read the body as TEXT first. `response.json()` would collapse "the endpoint sent HTML" and
      // "the endpoint sent a verdict" into one throw, and the raw text is what the decoder quotes
      // back — so a misconfigured endpoint is identifiable from the reason alone.
      return decodeHookVerdict(await response.text(), 'http');
    } catch (err: unknown) {
      return toTransportOutcome(err);
    }
  }
}

/**
 * Classify a `fetch` rejection.
 *
 * `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`, which is a different
 * fact from a connection refused or dropped: one says the hook was too slow, the other says it was
 * never reached. Both are `error`, and an operator reading the reason needs to know which.
 */
function toTransportOutcome(err: unknown): THookOutcome {
  return {
    outcome: 'error',
    source: 'http',
    kind: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'transport-failure',
    reason: err instanceof Error ? err.message : String(err),
  };
}
