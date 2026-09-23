import {
  buildValidationError,
  decodeDagDefinitionAsDagError,
  type IDagDefinition,
  type IDagError,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';

/** Parses a JSON string into a validated port payload object. */
export function parsePortPayload(input: string): TResult<TPortPayload, IDagError> {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_PAYLOAD_INVALID',
          'Payload must be a JSON object',
        ),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_PAYLOAD_PARSE_FAILED',
        'Failed to parse payload JSON',
      ),
    };
  }
}

/**
 * Parses a serialized DAG definition snapshot through the canonical total decoder (issue #2077), so a
 * snapshot with a malformed nested node or edge is a diagnostic here rather than a `TypeError` later.
 */
export function parseDefinitionSnapshot(input: string): TResult<IDagDefinition, IDagError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
    // allow-fallback: a parse failure is returned as a typed error result, not swallowed
  } catch {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
        'Failed to parse definition snapshot JSON',
      ),
    };
  }
  return decodeDagDefinitionAsDagError(
    parsed,
    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
    'Definition snapshot must be a valid DAG definition object',
  );
}
