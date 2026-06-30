import { describe, expect, it, vi } from 'vitest';
import { nodeCommand } from '../commands/node.js';
import type { INodeCommandOptions } from '../commands/node.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createOptions(): INodeCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async () => {
        throw new Error('readTextFile not used in node command');
      },
      writeBinaryStream: async () => {
        // not used in node command
      },
    },
    written,
  };
}

function getOutput(options: { readonly written: string[] }): string {
  return options.written.join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('nodeCommand', () => {
  describe('argument validation', () => {
    it('fails with exit code 2 when no subcommand is provided', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand([], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('node requires a subcommand');
    });

    it('fails with exit code 2 for unknown subcommand', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['unknown'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('Unknown node subcommand');
    });
  });

  describe('node list', () => {
    it('returns all 14+ node types in table output', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['list'], options);

      expect(exitCode).toBe(0);
      // The default registry has 14 node definitions
      const output = getOutput(options);
      // Check some known node types appear
      expect(output).toContain('input');
      expect(output).toContain('text-output');
      expect(output).toContain('llm-text-anthropic');
      expect(output).toContain('llm-text-openai');
      expect(output).toContain('transform');
    });

    it('returns JSON with correct structure when --output json', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['list', '--output', 'json'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        nodes: Array<{
          nodeType: string;
          displayName: string;
          category: string;
          defaultInputPort: string | null;
          defaultOutputPort: string | null;
        }>;
      };
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(parsed.nodes.length).toBeGreaterThanOrEqual(14);
      const first = parsed.nodes[0];
      expect(first).toHaveProperty('nodeType');
      expect(first).toHaveProperty('displayName');
      expect(first).toHaveProperty('category');
      expect(first).toHaveProperty('defaultInputPort');
      expect(first).toHaveProperty('defaultOutputPort');
    });

    it('returns JSON with correct structure when --json shorthand', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['list', '--json'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as { nodes: Array<{ nodeType: string }> };
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(parsed.nodes.length).toBeGreaterThanOrEqual(14);
    });

    it('filters by category when --category is specified', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(
        ['list', '--category', 'Core', '--output', 'json'],
        options,
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        nodes: Array<{ category: string }>;
      };
      expect(parsed.nodes.length).toBeGreaterThan(0);
      for (const node of parsed.nodes) {
        expect(node.category.toLowerCase()).toBe('core');
      }
    });
  });

  describe('node info', () => {
    it('succeeds for a known node type (llm-text-anthropic)', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['info', 'llm-text-anthropic'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('llm-text-anthropic');
      expect(output).toContain('LLM Text Anthropic');
    });

    it('returns shaped JSON when --output json', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(
        ['info', 'llm-text-anthropic', '--output', 'json'],
        options,
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        nodeType: string;
        displayName: string;
        category: string;
        defaultInputPort: string | null;
        defaultOutputPort: string | null;
        inputs: Array<{ portKey: string; type: string; required: boolean }>;
        outputs: Array<{ portKey: string; type: string; required: boolean }>;
        configSchema: Record<string, unknown> | null;
      };
      expect(parsed.nodeType).toBe('llm-text-anthropic');
      expect(parsed.displayName).toBe('LLM Text Anthropic');
      expect(Array.isArray(parsed.inputs)).toBe(true);
      expect(Array.isArray(parsed.outputs)).toBe(true);
      const firstInput = parsed.inputs[0];
      expect(firstInput).toHaveProperty('portKey');
      expect(firstInput).toHaveProperty('type');
      expect(firstInput).toHaveProperty('required');
    });

    it('returns shaped JSON when --json shorthand', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['info', 'transform', '--json'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        nodeType: string;
        configSchema: Record<string, unknown> | null;
      };
      expect(parsed.nodeType).toBe('transform');
      expect(parsed.configSchema).not.toBeNull();
    });

    it('shows config keys in pretty output when configSchema is present', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['info', 'transform'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('Config keys:');
    });

    it('fails with exit code 2 for unknown node type', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['info', 'unknown-type'], options);

      expect(exitCode).toBe(2);
      const output = getOutput(options);
      expect(output).toContain('Unknown node type "unknown-type"');
    });

    it('suggests similar node types when nodeType not found', async () => {
      const options = createOptions();

      // 'text' appears in many node types
      const exitCode = await nodeCommand(['info', 'llm-text'], options);

      expect(exitCode).toBe(2);
      const output = getOutput(options);
      expect(output).toContain('llm-text');
      // Should suggest nodes that include 'llm-text'
      expect(output).toContain('llm-text-anthropic');
    });
  });

  describe('node schema', () => {
    it('succeeds for a known node type (llm-text-anthropic)', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['schema', 'llm-text-anthropic'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      // Should output some JSON schema
      const parsed = JSON.parse(output) as {
        nodeType: string;
        configSchema: Record<string, unknown>;
      };
      expect(parsed.nodeType).toBe('llm-text-anthropic');
      expect(parsed.configSchema).toBeDefined();
    });

    it('fails with exit code 2 for unknown node type', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['schema', 'totally-unknown-node'], options);

      expect(exitCode).toBe(2);
      const output = getOutput(options);
      expect(output).toContain('Unknown node type');
    });
  });

  describe('node example', () => {
    it('generates an example DAG JSON for a known node type', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['example', 'transform'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      // Should output JSON with the node type embedded
      expect(output).toContain('transform');
      expect(output).toContain('dagId');
      expect(output).toContain('nodes');
    });

    it('generates an example DAG JSON for llm-text-anthropic', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['example', 'llm-text-anthropic'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('llm-text-anthropic');
      expect(output).toContain('# Save and run this example');
    });

    it('fails with exit code 2 for unknown node type in example', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['example', 'unknown-node-xyz'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('Unknown node type');
    });

    it('fails with exit code 2 when no node type is given to example', async () => {
      const options = createOptions();

      const exitCode = await nodeCommand(['example'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('node example requires');
    });
  });

  describe('node info additional coverage', () => {
    it('returns JSON with unknown node type (covers JSON format error path)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['info', 'zzz-unknown-xyz', '--output', 'json'], options);
      expect(exitCode).toBe(2);
      const output = getOutput(options);
      const parsed = JSON.parse(output) as { error: string; suggestions?: string[] };
      expect(parsed.error).toContain('Unknown node type');
    });

    it('returns pretty info for input node (covers defaultInputPort=undefined path)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['info', 'input'], options);
      expect(exitCode).toBe(0);
      // input node has no defaultInputPort
      const output = getOutput(options);
      expect(output).toContain('input');
    });

    it('returns pretty info for text-output node (covers defaultOutputPort=undefined path)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['info', 'text-output'], options);
      expect(exitCode).toBe(0);
    });

    it('returns error for --category with no value', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['list', '--category'], options);
      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--category requires');
    });

    it('returns error for unknown flags in list subcommand', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['list', '--weird-flag'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --run used with info (not example)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['info', 'transform', '--run'], options);
      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--run can only be used');
    });

    it('returns error for unknown flags in info subcommand', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['info', 'transform', '--weird-flag'], options);
      expect(exitCode).toBe(2);
    });

    it('returns JSON for schema with unknown node type (no similar types)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['schema', 'zzz-completely-unknown-xyz-abc'], options);
      expect(exitCode).toBe(2);
      // The schema command always outputs JSON
      const output = getOutput(options);
      expect(output).toContain('Unknown node type');
    });

    it('returns JSON schema for input node (covers configSchema=null branch)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['schema', 'input'], options);
      // input may or may not have configSchema
      expect([0, 2]).toContain(exitCode);
    });

    it('filters list by non-existent category (returns empty list)', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(
        ['list', '--category', 'NonExistentCategory123', '--output', 'json'],
        options,
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as { nodes: unknown[] };
      expect(parsed.nodes).toHaveLength(0);
    });
  });

  describe('scaffold subcommand', () => {
    it('fails with exit code 2 when no name provided', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['scaffold'], options);
      expect(exitCode).toBe(2);
    });

    it('creates a local .dag.node.js file by default (NODEDX-001)', async () => {
      const { writeFile } = await import('node:fs/promises');
      const options = createOptions();
      const exitCode = await nodeCommand(['scaffold', 'my-processor'], options);
      expect(exitCode).toBe(0);
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('my-processor.dag.node.js'),
        expect.stringContaining('my-processor'),
        'utf8',
      );
      const output = getOutput(options);
      expect(output).toContain('my-processor.dag.node.js');
    });

    it('creates a local .dag.node.js file with --js flag (--js routes to local mode)', async () => {
      const { writeFile } = await import('node:fs/promises');
      const options = createOptions();
      const exitCode = await nodeCommand(['scaffold', 'my-node', '--js'], options);
      expect(exitCode).toBe(0);
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('my-node.dag.node.js'),
        expect.stringContaining('export const node'),
        'utf8',
      );
    });

    it('returns error for unexpected flags in scaffold', async () => {
      const options = createOptions();
      const exitCode = await nodeCommand(['scaffold', 'my-node', '--weird'], options);
      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('unexpected flags');
    });
  });
});
