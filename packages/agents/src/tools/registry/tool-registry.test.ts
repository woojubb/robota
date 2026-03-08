import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ITool, IToolResult, IParameterValidationResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/provider';
import { ValidationError } from '../../utils/errors';

// Mock the logger before importing ToolRegistry
vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { ToolRegistry } from './tool-registry';
import { logger } from '../../utils/logger';

/**
 * Create a mock ITool with the given schema
 */
function createMockTool(schema: IToolSchema): ITool {
    return {
        schema,
        execute: vi.fn<[TToolParameters], Promise<IToolResult>>().mockResolvedValue({
            success: true,
            data: 'mock result',
        }),
        validate: vi.fn<[TToolParameters], boolean>().mockReturnValue(true),
        validateParameters: vi.fn<[TToolParameters], IParameterValidationResult>().mockReturnValue({
            isValid: true,
            errors: [],
        }),
        getDescription: vi.fn<[], string>().mockReturnValue(schema.description),
    };
}

/**
 * Build a valid IToolSchema with sensible defaults
 */
function buildSchema(overrides: Partial<IToolSchema> = {}): IToolSchema {
    return {
        name: 'testTool',
        description: 'A test tool',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Test input' },
            },
            required: ['input'],
        },
        ...overrides,
    };
}

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
        vi.clearAllMocks();
    });

    // ----------------------------------------------------------------
    // register
    // ----------------------------------------------------------------
    describe('register', () => {
        it('should register a valid tool', () => {
            const tool = createMockTool(buildSchema());

            registry.register(tool);

            expect(registry.has('testTool')).toBe(true);
            expect(registry.get('testTool')).toBe(tool);
        });

        it('should throw when tool has no schema name', () => {
            const tool = createMockTool(buildSchema({ name: '' }));

            expect(() => registry.register(tool)).toThrow(ValidationError);
        });

        it('should warn but override on duplicate registration', () => {
            const tool1 = createMockTool(buildSchema());
            const tool2 = createMockTool(buildSchema());

            registry.register(tool1);
            registry.register(tool2);

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('already registered'),
                expect.objectContaining({ toolName: 'testTool' }),
            );
            expect(registry.get('testTool')).toBe(tool2);
        });

        it('should throw when schema has no description', () => {
            const schema = buildSchema({ description: '' });
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
            expect(() => registry.register(tool)).toThrow('description');
        });

        it('should throw when schema has no parameters', () => {
            const schema = buildSchema();
            // Force-remove parameters for this validation test
            (schema as Record<string, unknown>).parameters = undefined;
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
        });

        it('should throw when parameters type is not "object"', () => {
            const schema = buildSchema();
            (schema.parameters as Record<string, unknown>).type = 'array';
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
            expect(() => registry.register(tool)).toThrow('type must be "object"');
        });

        it('should throw when a parameter property has an invalid type', () => {
            const schema = buildSchema({
                parameters: {
                    type: 'object',
                    properties: {
                        badField: { type: 'integer' as 'string' },
                    },
                },
            });
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
            expect(() => registry.register(tool)).toThrow('invalid type');
        });

        it('should throw when a parameter property is missing its type', () => {
            const schema = buildSchema({
                parameters: {
                    type: 'object',
                    properties: {
                        noType: {} as { type: 'string' },
                    },
                },
            });
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
            expect(() => registry.register(tool)).toThrow('must have a type');
        });

        it('should throw when required fields are not defined in properties', () => {
            const schema = buildSchema({
                parameters: {
                    type: 'object',
                    properties: {
                        input: { type: 'string' },
                    },
                    required: ['input', 'missing'],
                },
            });
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).toThrow(ValidationError);
            expect(() => registry.register(tool)).toThrow('missing');
        });

        it('should accept valid parameter types: string, number, boolean, array, object', () => {
            const schema = buildSchema({
                parameters: {
                    type: 'object',
                    properties: {
                        s: { type: 'string' },
                        n: { type: 'number' },
                        b: { type: 'boolean' },
                        a: { type: 'array' },
                        o: { type: 'object' },
                    },
                },
            });
            const tool = createMockTool(schema);

            expect(() => registry.register(tool)).not.toThrow();
        });
    });

    // ----------------------------------------------------------------
    // unregister
    // ----------------------------------------------------------------
    describe('unregister', () => {
        it('should remove an existing tool', () => {
            const tool = createMockTool(buildSchema());
            registry.register(tool);

            registry.unregister('testTool');

            expect(registry.has('testTool')).toBe(false);
        });

        it('should warn but not throw when unregistering non-existent tool', () => {
            expect(() => registry.unregister('nonExistent')).not.toThrow();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('non-existent'),
            );
        });
    });

    // ----------------------------------------------------------------
    // get
    // ----------------------------------------------------------------
    describe('get', () => {
        it('should return the tool when it exists', () => {
            const tool = createMockTool(buildSchema());
            registry.register(tool);

            expect(registry.get('testTool')).toBe(tool);
        });

        it('should return undefined for a non-existing tool', () => {
            expect(registry.get('missing')).toBeUndefined();
        });
    });

    // ----------------------------------------------------------------
    // getAll
    // ----------------------------------------------------------------
    describe('getAll', () => {
        it('should return an empty array when no tools are registered', () => {
            expect(registry.getAll()).toEqual([]);
        });

        it('should return all registered tools', () => {
            const tool1 = createMockTool(buildSchema({ name: 'tool1' }));
            const tool2 = createMockTool(buildSchema({ name: 'tool2' }));

            registry.register(tool1);
            registry.register(tool2);

            const all = registry.getAll();
            expect(all).toHaveLength(2);
            expect(all).toContain(tool1);
            expect(all).toContain(tool2);
        });
    });

    // ----------------------------------------------------------------
    // getSchemas
    // ----------------------------------------------------------------
    describe('getSchemas', () => {
        it('should return schemas from all registered tools', () => {
            const schema1 = buildSchema({ name: 'tool1' });
            const schema2 = buildSchema({ name: 'tool2' });
            registry.register(createMockTool(schema1));
            registry.register(createMockTool(schema2));

            const schemas = registry.getSchemas();

            expect(schemas).toHaveLength(2);
            expect(schemas.map(s => s.name)).toEqual(['tool1', 'tool2']);
        });

        it('should return an empty array when no tools are registered', () => {
            expect(registry.getSchemas()).toEqual([]);
        });
    });

    // ----------------------------------------------------------------
    // has
    // ----------------------------------------------------------------
    describe('has', () => {
        it('should return true when tool exists', () => {
            registry.register(createMockTool(buildSchema()));
            expect(registry.has('testTool')).toBe(true);
        });

        it('should return false when tool does not exist', () => {
            expect(registry.has('nonExistent')).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // clear
    // ----------------------------------------------------------------
    describe('clear', () => {
        it('should remove all registered tools', () => {
            registry.register(createMockTool(buildSchema({ name: 'a' })));
            registry.register(createMockTool(buildSchema({ name: 'b' })));
            expect(registry.size()).toBe(2);

            registry.clear();

            expect(registry.size()).toBe(0);
            expect(registry.getAll()).toEqual([]);
        });
    });

    // ----------------------------------------------------------------
    // getToolNames
    // ----------------------------------------------------------------
    describe('getToolNames', () => {
        it('should return names of all registered tools', () => {
            registry.register(createMockTool(buildSchema({ name: 'alpha' })));
            registry.register(createMockTool(buildSchema({ name: 'beta' })));

            expect(registry.getToolNames()).toEqual(['alpha', 'beta']);
        });

        it('should return empty array when no tools exist', () => {
            expect(registry.getToolNames()).toEqual([]);
        });
    });

    // ----------------------------------------------------------------
    // getToolsByPattern
    // ----------------------------------------------------------------
    describe('getToolsByPattern', () => {
        beforeEach(() => {
            registry.register(createMockTool(buildSchema({ name: 'search_web' })));
            registry.register(createMockTool(buildSchema({ name: 'search_docs' })));
            registry.register(createMockTool(buildSchema({ name: 'calculate' })));
        });

        it('should filter by string pattern', () => {
            const results = registry.getToolsByPattern('search');
            expect(results).toHaveLength(2);
            expect(results.map(t => t.schema.name)).toEqual(['search_web', 'search_docs']);
        });

        it('should filter by RegExp pattern', () => {
            const results = registry.getToolsByPattern(/^calc/);
            expect(results).toHaveLength(1);
            expect(results[0].schema.name).toBe('calculate');
        });

        it('should return empty array when no tools match', () => {
            expect(registry.getToolsByPattern('nonexistent')).toEqual([]);
        });
    });

    // ----------------------------------------------------------------
    // size
    // ----------------------------------------------------------------
    describe('size', () => {
        it('should return 0 for empty registry', () => {
            expect(registry.size()).toBe(0);
        });

        it('should return correct count after registrations', () => {
            registry.register(createMockTool(buildSchema({ name: 'a' })));
            expect(registry.size()).toBe(1);

            registry.register(createMockTool(buildSchema({ name: 'b' })));
            expect(registry.size()).toBe(2);
        });

        it('should decrease after unregister', () => {
            registry.register(createMockTool(buildSchema({ name: 'x' })));
            registry.unregister('x');
            expect(registry.size()).toBe(0);
        });
    });
});
