import { z } from 'zod';
import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type {
    ICostEstimate,
    IDagNodeDefinition,
    INodeExecutionContext,
    INodeTaskHandler
} from '../types/node-lifecycle.js';
import { buildValidationError } from '../utils/error-builders.js';

function createConfigValidationError(
    nodeType: string,
    context: INodeExecutionContext,
    parseError: z.ZodError
): IDagError {
    const firstIssue = parseError.issues[0];
    const firstIssuePath = firstIssue?.path.join('.') ?? 'config';
    const firstIssueMessage = firstIssue?.message ?? 'Invalid config';
    return buildValidationError(
        'DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID',
        `Node config does not satisfy schema: ${firstIssuePath} ${firstIssueMessage}`,
        {
            nodeId: context.nodeDefinition.nodeId,
            nodeType,
            issueCount: parseError.issues.length
        }
    );
}

/**
 * Base class for all DAG node definitions. Handles config schema parsing via zod
 * and delegates lifecycle methods to typed `*WithConfig` overrides.
 *
 * Subclasses must implement `configSchemaDefinition`, metadata fields, and
 * at minimum `executeWithConfig`. Optional lifecycle hooks:
 * `initializeWithConfig`, `estimateCostWithConfig`, `validateInputWithConfig`,
 * `validateOutputWithConfig`, `disposeWithConfig`.
 *
 * @see IDagNodeDefinition - interface this class implements
 * @see NodeIoAccessor - helper for typed input/output access in execute methods
 */
export abstract class AbstractNodeDefinition<TSchema extends z.ZodTypeAny> implements IDagNodeDefinition {
    public abstract readonly nodeType: string;
    public abstract readonly displayName: string;
    public abstract readonly category: string;
    public abstract readonly inputs: IDagNodeDefinition['inputs'];
    public abstract readonly outputs: IDagNodeDefinition['outputs'];
    public abstract readonly configSchemaDefinition: TSchema;

    public readonly taskHandler: INodeTaskHandler;

    protected constructor() {
        this.taskHandler = {
            initialize: async (context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.initializeWithConfig(context, configResult.value);
            },
            validateInput: async (input, context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.validateInputWithConfig(input, context, configResult.value);
            },
            estimateCost: async (input, context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.estimateCostWithConfig(input, context, configResult.value);
            },
            execute: async (input, context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.executeWithConfig(input, context, configResult.value);
            },
            validateOutput: async (output, context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.validateOutputWithConfig(output, context, configResult.value);
            },
            dispose: async (context) => {
                const configResult = this.parseNodeConfig(context);
                if (!configResult.ok) {
                    return configResult;
                }
                return this.disposeWithConfig(context, configResult.value);
            }
        };
    }

    protected parseNodeConfig(context: INodeExecutionContext): TResult<z.output<TSchema>, IDagError> {
        const parseResult = this.configSchemaDefinition.safeParse(context.nodeDefinition.config);
        if (!parseResult.success) {
            return {
                ok: false,
                error: createConfigValidationError(this.nodeType, context, parseResult.error)
            };
        }
        return {
            ok: true,
            value: parseResult.data
        };
    }

    protected async initializeWithConfig(
        _context: INodeExecutionContext,
        _config: z.output<TSchema>
    ): Promise<TResult<void, IDagError>> {
        return {
            ok: true,
            value: undefined
        };
    }

    protected async validateInputWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<TSchema>
    ): Promise<TResult<void, IDagError>> {
        return {
            ok: true,
            value: undefined
        };
    }

    public abstract estimateCostWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<TSchema>
    ): Promise<TResult<ICostEstimate, IDagError>>;

    protected abstract executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<TSchema>
    ): Promise<TResult<TPortPayload, IDagError>>;

    protected async validateOutputWithConfig(
        _output: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<TSchema>
    ): Promise<TResult<void, IDagError>> {
        return {
            ok: true,
            value: undefined
        };
    }

    protected async disposeWithConfig(
        _context: INodeExecutionContext,
        _config: z.output<TSchema>
    ): Promise<TResult<void, IDagError>> {
        return {
            ok: true,
            value: undefined
        };
    }
}

