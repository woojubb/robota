import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Tools } from './tool-manager';
import type { IToolSchema } from '../interfaces/provider';
import type { TToolParameters } from '../interfaces/tool';
import { ToolExecutionError } from '../utils/errors';

describe('Tools (ToolManager)', () => {
  let toolManager: Tools;

  const mockToolSchema: IToolSchema = {
    name: 'testTool',
    description: 'A test tool',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Test input',
        },
      },
      required: ['input'],
    },
  };

  const mockExecutor = async (params: TToolParameters) => {
    return `Processed: ${params.input}`;
  };

  beforeEach(async () => {
    toolManager = new Tools({ resolveToolSearchMode: () => 'off' });
    await toolManager.initialize();
  });

  afterEach(async () => {
    await toolManager.dispose();
  });

  describe('Initialization and Disposal', () => {
    it('should initialize successfully', async () => {
      const newManager = new Tools({ resolveToolSearchMode: () => 'off' });
      await expect(newManager.initialize()).resolves.not.toThrow();
      await newManager.dispose();
    });

    it('should dispose successfully', async () => {
      await expect(toolManager.dispose()).resolves.not.toThrow();
    });

    it('should clear all tools on disposal', async () => {
      toolManager.addTool(mockToolSchema, mockExecutor);
      expect(toolManager.getToolCount()).toBe(1);

      await toolManager.dispose();
      await toolManager.initialize();

      expect(toolManager.getToolCount()).toBe(0);
    });
  });

  describe('Tool Registration', () => {
    it('should register a tool successfully', () => {
      toolManager.addTool(mockToolSchema, mockExecutor);

      expect(toolManager.hasTool('testTool')).toBe(true);
      expect(toolManager.getToolCount()).toBe(1);
    });

    it('should get tool schema correctly', () => {
      toolManager.addTool(mockToolSchema, mockExecutor);

      const schema = toolManager.getToolSchema('testTool');
      expect(schema).toEqual(mockToolSchema);
    });

    it('should get tool instance correctly', () => {
      toolManager.addTool(mockToolSchema, mockExecutor);

      const tool = toolManager.getTool('testTool');
      expect(tool).toBeDefined();
      expect(tool?.schema).toEqual(mockToolSchema);
    });

    it('should remove a tool successfully', () => {
      toolManager.addTool(mockToolSchema, mockExecutor);
      expect(toolManager.hasTool('testTool')).toBe(true);

      toolManager.removeTool('testTool');
      expect(toolManager.hasTool('testTool')).toBe(false);
      expect(toolManager.getToolCount()).toBe(0);
    });

    it('should handle multiple tools', () => {
      const schema2: IToolSchema = {
        name: 'testTool2',
        description: 'Another test tool',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
          required: ['value'],
        },
      };

      toolManager.addTool(mockToolSchema, mockExecutor);
      toolManager.addTool(schema2, async (params) =>
        typeof params.value === 'number' ? params.value * 2 : 0,
      );

      expect(toolManager.getToolCount()).toBe(2);
      expect(toolManager.hasTool('testTool')).toBe(true);
      expect(toolManager.hasTool('testTool2')).toBe(true);
    });
  });

  describe('Tool Execution', () => {
    beforeEach(() => {
      toolManager.addTool(mockToolSchema, mockExecutor);
    });

    it('should execute tool successfully', async () => {
      const result = await toolManager.executeTool('testTool', { input: 'test' });
      expect(result).toBe('Processed: test');
    });

    it('should throw error for non-existent tool', async () => {
      await expect(toolManager.executeTool('nonExistent', { input: 'test' })).rejects.toThrow(
        ToolExecutionError,
      );
    });

    it('should throw error for tool execution failure', async () => {
      const failingExecutor = async () => {
        throw new Error('Execution failed');
      };

      const failingSchema: IToolSchema = {
        name: 'failingTool',
        description: 'A failing tool',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      };

      toolManager.addTool(failingSchema, failingExecutor);

      await expect(toolManager.executeTool('failingTool', {})).rejects.toThrow(ToolExecutionError);
    });
  });

  describe('Tool Filtering', () => {
    beforeEach(() => {
      const schemas = [
        {
          name: 'tool1',
          description: 'Tool 1',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'tool3',
          description: 'Tool 3',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ] as IToolSchema[];

      schemas.forEach((schema) => {
        toolManager.addTool(schema, async () => 'result');
      });
    });

    it('should return all tools when no filter is set', () => {
      const tools = toolManager.getTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('should filter tools by allowed list', () => {
      toolManager.setAllowedTools(['tool1', 'tool3']);

      const tools = toolManager.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool3']);
    });

    it('should get and set allowed tools correctly', () => {
      expect(toolManager.getAllowedTools()).toBeUndefined();

      toolManager.setAllowedTools(['tool1', 'tool2']);
      expect(toolManager.getAllowedTools()).toEqual(['tool1', 'tool2']);
    });

    it('should prevent execution of non-allowed tools', async () => {
      toolManager.setAllowedTools(['tool1']);

      await expect(toolManager.executeTool('tool2', {})).rejects.toThrow(ToolExecutionError);
    });

    it('should allow execution of allowed tools', async () => {
      toolManager.setAllowedTools(['tool1']);

      await expect(toolManager.executeTool('tool1', {})).resolves.toBe('result');
    });
  });

  describe('Registry Access', () => {
    it('should provide access to tool registry', () => {
      const registry = toolManager.getRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
      expect(typeof registry.get).toBe('function');
    });

    it('should return correct tool count', () => {
      expect(toolManager.getToolCount()).toBe(0);

      toolManager.addTool(mockToolSchema, mockExecutor);
      expect(toolManager.getToolCount()).toBe(1);

      toolManager.addTool(
        {
          name: 'tool2',
          description: 'Tool 2',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        async () => 'result',
      );
      expect(toolManager.getToolCount()).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle undefined tool schema gracefully', () => {
      const schema = toolManager.getToolSchema('nonExistent');
      expect(schema).toBeUndefined();
    });

    it('should handle undefined tool instance gracefully', () => {
      const tool = toolManager.getTool('nonExistent');
      expect(tool).toBeUndefined();
    });

    it('should handle checking non-existent tool', () => {
      expect(toolManager.hasTool('nonExistent')).toBe(false);
    });

    it('should handle removing non-existent tool gracefully', () => {
      expect(() => toolManager.removeTool('nonExistent')).not.toThrow();
    });
  });
});

describe('Tools visibility (issue #3081)', () => {
  const schema = (name: string): IToolSchema => ({
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
  });

  it('withholds a hidden tool from the offered set, read live on every call', async () => {
    const hidden = new Set(['Bash']);
    const manager = new Tools({
      resolveToolSearchMode: () => 'off',
      isToolVisible: (name) => !hidden.has(name),
    });
    await manager.initialize();
    manager.addTool(schema('Read'), async () => 'ok');
    manager.addTool(schema('Bash'), async () => 'ok');

    expect(manager.getOfferedTools().map((tool) => tool.name)).toEqual(['Read']);
    hidden.clear();
    expect(manager.getOfferedTools().map((tool) => tool.name)).toEqual(['Read', 'Bash']);
    await manager.dispose();
  });
});

describe('a hidden tool cannot be loaded by name (issue #3081)', () => {
  it('loadDeferredTools treats a hidden name as unregistered', async () => {
    const manager = new Tools({
      resolveToolSearchMode: () => 'on',
      isToolVisible: (name) => name !== 'Secret',
    });
    await manager.initialize();
    manager.addTool(
      { name: 'Secret', description: 'hidden', parameters: { type: 'object', properties: {} }, deferLoading: true },
      async () => 'ok',
    );
    expect(() => manager.loadDeferredTools(['Secret'])).toThrow(/not registered/);
    await manager.dispose();
  });
});
