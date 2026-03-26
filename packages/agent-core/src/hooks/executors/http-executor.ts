/**
 * HTTP hook executor — POSTs hook input as JSON to a URL.
 *
 * Response format: { ok: boolean, reason?: string }
 * - ok: true  → exit code 0
 * - ok: false → exit code 2 (blocked), reason in stderr
 *
 * Supports env var interpolation in headers: $VAR_NAME
 */

import type { IHttpHookDefinition, IHookInput, IHookResult, IHookTypeExecutor } from '../types.js';

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

  async execute(definition: IHttpHookDefinition, input: IHookInput): Promise<IHookResult> {
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
          exitCode: 1,
          stdout: '',
          stderr: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      const body = (await response.json()) as { ok: boolean; reason?: string };

      if (!body.ok) {
        return {
          exitCode: 2,
          stdout: '',
          stderr: body.reason ?? 'Blocked by HTTP hook',
        };
      }

      return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: message };
    }
  }
}
