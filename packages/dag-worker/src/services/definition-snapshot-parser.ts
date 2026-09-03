import {
  buildValidationError,
  decodeDagDefinitionAsDagError,
  type IDagDefinition,
  type IDagError,
  type IDagRun,
  type TResult,
} from '@robota-sdk/dag-core';

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Parses the definition snapshot JSON string from a DAG run record through the canonical total
 * decoder (issue #2077), so a malformed nested node or edge is a diagnostic with a field path.
 *
 * @param dagRun - The DAG run containing the snapshot to parse.
 * @param dagRunId - The identifier used for error context.
 * @returns The parsed definition or a validation error.
 */
export function parseDefinitionSnapshot(
  dagRun: IDagRun,
  dagRunId: string,
): TResult<IDagDefinition, IDagError> {
  if (
    typeof dagRun.definitionSnapshot !== 'string' ||
    dagRun.definitionSnapshot.trim().length === 0
  ) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING',
        'DagRun definition snapshot is missing',
        { dagRunId },
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dagRun.definitionSnapshot);
    // allow-fallback: a parse failure is returned as a typed error result, not swallowed
  } catch (error) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
        'Failed to parse DagRun definition snapshot',
        { dagRunId, errorMessage: resolveErrorMessage(error) },
      ),
    };
  }
  return decodeDagDefinitionAsDagError(
    parsed,
    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
    'DagRun definition snapshot has invalid shape',
    { dagRunId },
  );
}
