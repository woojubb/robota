import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IToolSchema } from '../../interfaces/provider';
import type { TToolParameters, IToolExecutionContext } from '../../interfaces/tool';
import { ValidationError, ToolExecutionError } from '../../utils/errors';

// Mock the logger used by AbstractTool (via SilentLogger default, but also the module logger)
vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    SilentLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    })),
}));

import { FunctionTool, createFunctionTool } from './function-tool';

/**
 * Build a minimal valid schema for testing
 */
function buildSchema(overrides: Partial<IToolSchema> = {}): IToolSchema {
    return {
        name: 'echo',
        description: 'Echoes back the input',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'Message to echo' },
            },
            required: ['message'],
        },
        ...overrides,
    };
}

/**
 * Build a minimal execution context
 */
function buildContext(overrides: Partial<IToolExecutionContext> = {}): IToolExecutionContext {
    return {
        toolName: 'echo',
        parameters: { message: 'hello' },
        ...overrides,
    };
}

describe('FunctionTool', () => {
    // ----------------------------------------------------------------
    // Construction
    // ----------------------------------------------------------------
    describe('construction', () => {
        it('should construct with valid schema and function', () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockResolvedValue('ok');
            const tool = new FunctionTool(buildSchema(), fn);

            expect(tool.schema.name).toBe('echo');
            expect(tool.fn).toBe(fn);
        });

        it('should throw when schema is missing a name', () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockResolvedValue('ok');

            expect(() => new FunctionTool(buildSchema({ name: '' }), fn)).toThrow(ValidationError);
        });

        it('should throw when function is not provided', () => {
            expect(
                () => new FunctionTool(buildSchema(), undefined as unknown as typeof vi.fn),
            ).toThrow(ValidationError);
        });

        it('should throw when function is not callable', () => {
            expect(
                () => new FunctionTool(buildSchema(), 'notAFunction' as unknown as typeof vi.fn),
            ).toThrow(ValidationError);
        });
    });

    // ----------------------------------------------------------------
    // schema
    // ----------------------------------------------------------------
    describe('schema', () => {
        it('should expose the schema passed at construction', () => {
            const schema = buildSchema({ name: 'myTool', description: 'My tool' });
            const tool = new FunctionTool(schema, vi.fn().mockResolvedValue('ok'));

            expect(tool.schema).toEqual(schema);
        });
    });

    // ----------------------------------------------------------------
    // getDescription
    // ----------------------------------------------------------------
    describe('getDescription', () => {
        it('should return the schema description', () => {
            const tool = new FunctionTool(
                buildSchema({ description: 'Does something' }),
                vi.fn().mockResolvedValue('ok'),
            );

            expect(tool.getDescription()).toBe('Does something');
        });
    });

    // ----------------------------------------------------------------
    // validate
    // ----------------------------------------------------------------
    describe('validate', () => {
        let tool: FunctionTool;

        beforeEach(() => {
            tool = new FunctionTool(buildSchema(), vi.fn().mockResolvedValue('ok'));
        });

        it('should return true for valid parameters', () => {
            expect(tool.validate({ message: 'hello' })).toBe(true);
        });

        it('should return false when required parameter is missing', () => {
            expect(tool.validate({})).toBe(false);
        });

        it('should return false for wrong parameter type', () => {
            expect(tool.validate({ message: 123 })).toBe(false);
        });

        it('should return false for unknown parameters', () => {
            expect(tool.validate({ message: 'hi', extra: 'field' })).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // validateParameters (detailed)
    // ----------------------------------------------------------------
    describe('validateParameters', () => {
        let tool: FunctionTool;

        beforeEach(() => {
            tool = new FunctionTool(buildSchema(), vi.fn().mockResolvedValue('ok'));
        });

        it('should return isValid true with empty errors for valid params', () => {
            const result = tool.validateParameters({ message: 'hello' });
            expect(result.isValid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it('should report missing required parameter', () => {
            const result = tool.validateParameters({});
            expect(result.isValid).toBe(false);
            expect(result.errors).toEqual(
                expect.arrayContaining([expect.stringContaining('Missing required parameter')]),
            );
        });

        it('should report wrong type', () => {
            const result = tool.validateParameters({ message: 42 });
            expect(result.isValid).toBe(false);
            expect(result.errors).toEqual(
                expect.arrayContaining([expect.stringContaining('must be a string')]),
            );
        });
    });

    // ----------------------------------------------------------------
    // execute
    // ----------------------------------------------------------------
    describe('execute', () => {
        it('should execute and return success result', async () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockResolvedValue('echoed');
            const tool = new FunctionTool(buildSchema(), fn);
            const context = buildContext();

            const result = await tool.execute({ message: 'hello' }, context);

            expect(result.success).toBe(true);
            expect(result.data).toBe('echoed');
            expect(fn).toHaveBeenCalledWith({ message: 'hello' }, context);
        });

        it('should throw ValidationError for invalid parameters', async () => {
            const tool = new FunctionTool(buildSchema(), vi.fn().mockResolvedValue('ok'));

            await expect(tool.execute({}, buildContext())).rejects.toThrow(ValidationError);
        });

        it('should wrap unexpected errors in ToolExecutionError', async () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockRejectedValue(
                new Error('boom'),
            );
            const tool = new FunctionTool(buildSchema(), fn);

            await expect(
                tool.execute({ message: 'hi' }, buildContext()),
            ).rejects.toThrow(ToolExecutionError);
        });

        it('should re-throw ToolExecutionError as-is', async () => {
            const original = new ToolExecutionError('custom', 'echo');
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockRejectedValue(original);
            const tool = new FunctionTool(buildSchema(), fn);

            await expect(
                tool.execute({ message: 'hi' }, buildContext()),
            ).rejects.toBe(original);
        });

        it('should include execution metadata in result', async () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockResolvedValue('ok');
            const tool = new FunctionTool(buildSchema(), fn);

            const result = await tool.execute({ message: 'hi' }, buildContext());

            expect(result.metadata).toBeDefined();
            expect(result.metadata?.toolName).toBe('echo');
            expect(typeof result.metadata?.executionTime).toBe('number');
        });
    });

    // ----------------------------------------------------------------
    // Parameter type validation (various types)
    // ----------------------------------------------------------------
    describe('parameter type validation', () => {
        const multiTypeSchema = buildSchema({
            name: 'multi',
            description: 'Multi-type tool',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    count: { type: 'number' },
                    enabled: { type: 'boolean' },
                    tags: { type: 'array', items: { type: 'string' } },
                    config: { type: 'object' },
                },
                required: ['name'],
            },
        });

        let tool: FunctionTool;

        beforeEach(() => {
            tool = new FunctionTool(multiTypeSchema, vi.fn().mockResolvedValue('ok'));
        });

        it('should accept valid string parameter', () => {
            expect(tool.validate({ name: 'test' })).toBe(true);
        });

        it('should reject number where string is expected', () => {
            expect(tool.validate({ name: 123 })).toBe(false);
        });

        it('should accept valid number parameter', () => {
            expect(tool.validate({ name: 'a', count: 5 })).toBe(true);
        });

        it('should reject string where number is expected', () => {
            expect(tool.validate({ name: 'a', count: 'five' })).toBe(false);
        });

        it('should accept valid boolean parameter', () => {
            expect(tool.validate({ name: 'a', enabled: true })).toBe(true);
        });

        it('should reject string where boolean is expected', () => {
            expect(tool.validate({ name: 'a', enabled: 'yes' })).toBe(false);
        });

        it('should accept valid array parameter', () => {
            expect(tool.validate({ name: 'a', tags: ['x', 'y'] })).toBe(true);
        });

        it('should reject non-array where array is expected', () => {
            expect(tool.validate({ name: 'a', tags: 'notArray' })).toBe(false);
        });

        it('should reject array with wrong item types', () => {
            expect(tool.validate({ name: 'a', tags: [1, 2] })).toBe(false);
        });

        it('should accept valid object parameter', () => {
            expect(tool.validate({ name: 'a', config: { key: 'val' } })).toBe(true);
        });

        it('should reject non-object where object is expected', () => {
            expect(tool.validate({ name: 'a', config: 'notObj' })).toBe(false);
        });

        it('should reject null where object is expected', () => {
            expect(tool.validate({ name: 'a', config: null })).toBe(false);
        });

        it('should reject array where object is expected', () => {
            expect(tool.validate({ name: 'a', config: [1, 2] })).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // Enum constraint validation
    // ----------------------------------------------------------------
    describe('enum constraint validation', () => {
        const enumSchema = buildSchema({
            name: 'enumTool',
            description: 'Tool with enum param',
            parameters: {
                type: 'object',
                properties: {
                    color: { type: 'string', enum: ['red', 'green', 'blue'] },
                },
                required: ['color'],
            },
        });

        let tool: FunctionTool;

        beforeEach(() => {
            tool = new FunctionTool(enumSchema, vi.fn().mockResolvedValue('ok'));
        });

        it('should accept a value in the enum', () => {
            expect(tool.validate({ color: 'red' })).toBe(true);
        });

        it('should reject a value not in the enum', () => {
            expect(tool.validate({ color: 'yellow' })).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // createFunctionTool helper
    // ----------------------------------------------------------------
    describe('createFunctionTool helper', () => {
        it('should create a FunctionTool with the given parameters', () => {
            const fn = vi.fn<[TToolParameters], Promise<string>>().mockResolvedValue('ok');
            const tool = createFunctionTool(
                'helper',
                'Helper tool',
                {
                    type: 'object',
                    properties: { x: { type: 'number' } },
                    required: ['x'],
                },
                fn,
            );

            expect(tool).toBeInstanceOf(FunctionTool);
            expect(tool.schema.name).toBe('helper');
            expect(tool.schema.description).toBe('Helper tool');
            expect(tool.fn).toBe(fn);
        });
    });
});
