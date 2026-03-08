import { buildValidationError } from '../utils/error-builders.js';
import { parseListPortHandleKey } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type { TPortPayload, TPortValue } from '../interfaces/ports.js';
import { MediaReference, type IMediaReferenceCandidate } from '../value-objects/media-reference.js';
import { parseBinaryValue, type IParsedBinaryValue } from './binary-value-parser.js';

/**
 * Typed accessor for reading node inputs and building node outputs within execute methods.
 *
 * Provides `requireInput*` helpers that return `TResult` with validation errors,
 * and `setOutput` / `toOutput` for constructing the output payload.
 *
 * @see AbstractNodeDefinition - base class that uses this accessor in lifecycle hooks
 */
export class NodeIoAccessor {
    private readonly output: TPortPayload = {};

    public constructor(
        private readonly input: TPortPayload,
        private readonly nodeId: string
    ) {}

    public getInput(key: string): TPortValue | undefined {
        return this.input[key];
    }

    public requireInput(key: string): TResult<TPortValue, IDagError> {
        const value = this.getInput(key);
        if (typeof value === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_MISSING',
                    'Node input key is missing',
                    { nodeId: this.nodeId, key }
                )
            };
        }
        return { ok: true, value };
    }

    public requireInputString(key: string): TResult<string, IDagError> {
        const inputResult = this.requireInput(key);
        if (!inputResult.ok) {
            return inputResult;
        }
        if (typeof inputResult.value !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                    'Node input key must be string',
                    { nodeId: this.nodeId, key, expectedType: 'string' }
                )
            };
        }
        return { ok: true, value: inputResult.value };
    }

    public requireInputArray(key: string): TResult<TPortValue[], IDagError> {
        const directValue = this.getInput(key);
        if (Array.isArray(directValue)) {
            return { ok: true, value: directValue };
        }
        const listHandleValues = this.collectListHandleValues(key);
        if (listHandleValues) {
            return { ok: true, value: listHandleValues };
        }
        if (typeof directValue === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_MISSING',
                    'Node input key is missing',
                    { nodeId: this.nodeId, key }
                )
            };
        }
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                'Node input key must be array',
                { nodeId: this.nodeId, key, expectedType: 'array' }
            )
        };
    }

    public requireInputBinary(
        key: string,
        kind?: 'image' | 'video' | 'audio' | 'file'
    ): TResult<IParsedBinaryValue, IDagError> {
        const inputResult = this.requireInput(key);
        if (!inputResult.ok) {
            return inputResult;
        }
        return parseBinaryValue(inputResult.value, this.nodeId, key, kind);
    }

    public requireInputBinaryList(
        key: string,
        kind?: 'image' | 'video' | 'audio' | 'file',
        options?: { minItems?: number; maxItems?: number }
    ): TResult<IParsedBinaryValue[], IDagError> {
        const arrayResult = this.requireInputArray(key);
        if (!arrayResult.ok) {
            return arrayResult;
        }
        const values = arrayResult.value;
        if (typeof options?.minItems === 'number' && values.length < options.minItems) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED',
                    'Node input list does not satisfy minItems',
                    { nodeId: this.nodeId, key, minItems: options.minItems, actualItems: values.length }
                )
            };
        }
        if (typeof options?.maxItems === 'number' && values.length > options.maxItems) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED',
                    'Node input list exceeds maxItems',
                    { nodeId: this.nodeId, key, maxItems: options.maxItems, actualItems: values.length }
                )
            };
        }
        const parsedValues: IParsedBinaryValue[] = [];
        for (const [index, value] of values.entries()) {
            const parsedResult = parseBinaryValue(value, this.nodeId, `${key}[${index}]`, kind);
            if (!parsedResult.ok) {
                return parsedResult;
            }
            parsedValues.push(parsedResult.value);
        }
        return { ok: true, value: parsedValues };
    }

    public requireInputMediaReference(
        key: string,
        options?: { allowStringUri?: boolean; allowStringAssetUri?: boolean }
    ): TResult<MediaReference, IDagError> {
        const inputResult = this.requireInput(key);
        if (!inputResult.ok) {
            return inputResult;
        }
        return this.parseMediaReferenceValue(inputResult.value, key, options);
    }

    public requireInputBinaryReference(
        key: string,
        kind?: 'image' | 'video' | 'audio' | 'file'
    ): TResult<MediaReference, IDagError> {
        const binaryResult = this.requireInputBinary(key, kind);
        if (!binaryResult.ok) {
            return binaryResult;
        }
        const parsedResult = MediaReference.fromBinary(binaryResult.value);
        if (!parsedResult.ok) {
            return {
                ok: false,
                error: buildValidationError(
                    parsedResult.error.code,
                    parsedResult.error.message,
                    { nodeId: this.nodeId, key, ...(parsedResult.error.context ?? {}) }
                )
            };
        }
        return parsedResult;
    }

    public setOutput(key: string, value: TPortValue): void {
        this.output[key] = value;
    }

    public toOutput(): TPortPayload {
        return { ...this.output };
    }

    private collectListHandleValues(portKey: string): TPortValue[] | undefined {
        const valuesByIndex = new Map<number, TPortValue>();
        for (const [handleKey, value] of Object.entries(this.input)) {
            const parsed = parseListPortHandleKey(handleKey);
            if (!parsed || parsed.portKey !== portKey) {
                continue;
            }
            valuesByIndex.set(parsed.index, value);
        }
        if (valuesByIndex.size === 0) {
            return undefined;
        }
        const sortedIndices = [...valuesByIndex.keys()].sort((a, b) => a - b);
        const expectedLength = sortedIndices[sortedIndices.length - 1] + 1;
        if (sortedIndices.length !== expectedLength) {
            return undefined;
        }
        const collected: TPortValue[] = [];
        for (let index = 0; index < expectedLength; index += 1) {
            const value = valuesByIndex.get(index);
            if (typeof value === 'undefined') {
                return undefined;
            }
            collected.push(value);
        }
        return collected;
    }

    private parseMediaReferenceValue(
        rawValue: TPortValue,
        key: string,
        options?: { allowStringUri?: boolean; allowStringAssetUri?: boolean }
    ): TResult<MediaReference, IDagError> {
        if (typeof rawValue === 'string') {
            if (options?.allowStringAssetUri === true && rawValue.startsWith('asset://')) {
                return this.wrapMediaReferenceError(
                    MediaReference.fromCandidate({ referenceType: 'asset', assetId: rawValue.slice('asset://'.length) }),
                    key
                );
            }
            if (options?.allowStringUri === true) {
                return this.wrapMediaReferenceError(
                    MediaReference.fromCandidate({ referenceType: 'uri', uri: rawValue }),
                    key
                );
            }
        }

        if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                    'Node input key must be media reference object',
                    { nodeId: this.nodeId, key, expectedType: 'media-reference' }
                )
            };
        }

        return this.wrapMediaReferenceError(
            MediaReference.fromCandidate(rawValue as IMediaReferenceCandidate),
            key
        );
    }

    private wrapMediaReferenceError(
        result: TResult<MediaReference, IDagError>,
        key: string
    ): TResult<MediaReference, IDagError> {
        if (result.ok) {
            return result;
        }
        return {
            ok: false,
            error: buildValidationError(
                result.error.code,
                result.error.message,
                { nodeId: this.nodeId, key, ...(result.error.context ?? {}) }
            )
        };
    }
}
