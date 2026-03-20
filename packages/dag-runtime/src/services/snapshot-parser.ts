import {
    buildValidationError,
    type IDagDefinition,
    type IDagError,
    type TPortPayload,
    type TResult
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
                    'Payload must be a JSON object'
                )
            };
        }
        return { ok: true, value: parsed };
    } catch {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_PAYLOAD_PARSE_FAILED',
                'Failed to parse payload JSON'
            )
        };
    }
}

/** Parses a serialized DAG definition snapshot and validates required fields. */
export function parseDefinitionSnapshot(input: string): TResult<IDagDefinition, IDagError> {
    try {
        const parsed = JSON.parse(input);
        if (
            typeof parsed !== 'object'
            || parsed === null
            || Array.isArray(parsed)
            || !('dagId' in parsed)
            || !('version' in parsed)
            || !('nodes' in parsed)
            || !('edges' in parsed)
            || !('status' in parsed)
            || typeof parsed.dagId !== 'string'
            || typeof parsed.version !== 'number'
            || !Array.isArray(parsed.nodes)
            || !Array.isArray(parsed.edges)
            || typeof parsed.status !== 'string'
        ) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
                    'Definition snapshot must be a valid DAG definition object'
                )
            };
        }
        return { ok: true, value: parsed as IDagDefinition };
    } catch {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
                'Failed to parse definition snapshot JSON'
            )
        };
    }
}
