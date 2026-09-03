import type { TConfigValue } from '@robota-sdk/agent-core';
import type { TSessionResponseFormat } from '@robota-sdk/agent-framework';

/**
 * Issue #2056 (CLI-081): `--json-schema` as OWNED structured-output policy.
 *
 * The flag used to reach the model as a sentence pushed into the system prompt — a behavioral
 * instruction invented by the shell, invisible to the provider capability table, and silently
 * degrading to prose on every provider. It now becomes the session's `responseFormat` of type
 * `json_schema`, which the core request assembly (CORE-043) routes per provider: sent as a schema
 * parameter where the wire carries one, stated once by the owner where it does not, and validated
 * against the schema on the way back. The shell decides nothing about that.
 *
 * Malformed input is a terminal startup error, not a prompt that says "here is some JSON".
 */
export function buildJsonSchemaResponseFormat(
  raw: string | undefined,
): TSessionResponseFormat | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // allow-fallback: converted into a typed startup error below; the flag value is user input
  } catch (error) {
    throw new Error(
      `--json-schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      '--json-schema must be a JSON object (a JSON Schema), not a primitive or array',
    );
  }
  return { type: 'json_schema', schema: parsed as Record<string, TConfigValue> };
}
