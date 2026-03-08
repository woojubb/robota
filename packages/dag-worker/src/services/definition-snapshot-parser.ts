import {
    buildValidationError,
    type IDagDefinition,
    type IDagError,
    type IDagRun,
    type TResult
} from '@robota-sdk/dag-core';

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return 'Unknown error';
}

/**
 * Parses the definition snapshot JSON string from a DAG run record
 * and validates its structural shape.
 *
 * @param dagRun - The DAG run containing the snapshot to parse.
 * @param dagRunId - The identifier used for error context.
 * @returns The parsed definition or a validation error.
 */
export function parseDefinitionSnapshot(
    dagRun: IDagRun,
    dagRunId: string
): TResult<IDagDefinition, IDagError> {
    if (typeof dagRun.definitionSnapshot !== 'string' || dagRun.definitionSnapshot.trim().length === 0) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING',
                'DagRun definition snapshot is missing',
                { dagRunId }
            )
        };
    }

    try {
        const parsed = JSON.parse(dagRun.definitionSnapshot);
        if (!isValidDefinitionShape(parsed)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
                    'DagRun definition snapshot has invalid shape',
                    { dagRunId }
                )
            };
        }
        return { ok: true, value: parsed as IDagDefinition };
    } catch (error) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
                'Failed to parse DagRun definition snapshot',
                { dagRunId, errorMessage: resolveErrorMessage(error) }
            )
        };
    }
}

/** Checks whether a parsed JSON value has the required fields for an IDagDefinition. */
function isValidDefinitionShape(parsed: unknown): boolean {
    return (
        typeof parsed === 'object'
        && parsed !== null
        && !Array.isArray(parsed)
        && typeof (parsed as Record<string, unknown>).dagId === 'string'
        && typeof (parsed as Record<string, unknown>).version === 'number'
        && Array.isArray((parsed as Record<string, unknown>).nodes)
        && Array.isArray((parsed as Record<string, unknown>).edges)
        && typeof (parsed as Record<string, unknown>).status === 'string'
    );
}
