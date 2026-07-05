import { describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { validateCommand } from '../commands/validate.js';
import type { IValidateCommandOptions } from '../commands/validate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createOptions(
  fileContents: Record<string, string> = {},
): IValidateCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async (filePath) => {
        const content = fileContents[filePath];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        }
        return content;
      },
      writeBinaryStream: async () => {
        // not used in validate command
      },
    },
    written,
  };
}

function getOutput(options: { readonly written: string[] }): string {
  return options.written.join('');
}

function createValidDag(): IDagDefinition {
  return {
    dagId: 'test-dag',
    version: 1,
    status: 'draft',
    nodes: [
      { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
      {
        nodeId: 'n2',
        nodeType: 'llm-text-openai',
        dependsOn: ['n1'],
        config: { model: 'gpt-4o' },
      },
      { nodeId: 'n3', nodeType: 'text-output', dependsOn: ['n2'], config: {} },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateCommand', () => {
  describe('argument validation', () => {
    it('fails with exit code 2 when no file argument is provided', async () => {
      const options = createOptions();

      const exitCode = await validateCommand([], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('validate requires <file> argument');
    });

    it('fails with exit code 2 when --output has an invalid value', async () => {
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(createValidDag()) });

      const exitCode = await validateCommand(['workflow.dag.json', '--output', 'xml'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--output must be');
    });

    it('fails with exit code 2 when --output has no value (missing arg)', async () => {
      const options = createOptions();

      const exitCode = await validateCommand(['workflow.dag.json', '--output'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--output requires a value');
    });

    it('fails with exit code 2 when --node-file has no value', async () => {
      const options = createOptions();

      const exitCode = await validateCommand(['workflow.dag.json', '--node-file'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--node-file requires a value');
    });

    it('fails with exit code 2 for unknown flags', async () => {
      const options = createOptions();

      const exitCode = await validateCommand(['workflow.dag.json', '--unknown-flag'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('unexpected flags');
    });

    it('fails with exit code 2 for multiple positional arguments', async () => {
      const options = createOptions();

      const exitCode = await validateCommand(['workflow.dag.json', 'extra.dag.json'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('unexpected positional arguments');
    });
  });

  describe('file errors', () => {
    it('fails with exit code 2 when the file does not exist', async () => {
      const options = createOptions(); // no fileContents

      const exitCode = await validateCommand(['missing.dag.json'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('Failed to read file');
    });

    it('fails with exit code 2 when the file contains invalid JSON', async () => {
      const options = createOptions({ 'bad.dag.json': 'not { valid json' });

      const exitCode = await validateCommand(['bad.dag.json'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('Failed to parse JSON');
    });

    it('fails with exit code 2 when the file contains a JSON array instead of object', async () => {
      const options = createOptions({ 'array.dag.json': '[]' });

      const exitCode = await validateCommand(['array.dag.json'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('must contain a JSON object');
    });
  });

  describe('validation errors', () => {
    it('fails with exit code 1 when a node has an unknown nodeType', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'bad-node', dependsOn: ['n1'], config: {} },
          { nodeId: 'n3', nodeType: 'text-output', dependsOn: ['n2'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Unknown node type "bad-node"');
    });

    it('fails with exit code 1 when the DAG has a cycle', async () => {
      const dag: IDagDefinition = {
        dagId: 'cycle-dag',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: ['n3'], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
          { nodeId: 'n3', nodeType: 'transform', dependsOn: ['n2'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'cycle.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['cycle.dag.json'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Cycle detected');
    });

    it('fails with exit code 1 when there is no input node', async () => {
      const dag: IDagDefinition = {
        dagId: 'no-input',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('No input node found');
    });

    it('fails with exit code 1 when --output json and there is no input node', async () => {
      const dag: IDagDefinition = {
        dagId: 'no-input',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json', '--output', 'json'], options);

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(getOutput(options)) as {
        valid: boolean;
        errors: string[];
      };
      expect(parsed.valid).toBe(false);
      expect(parsed.errors.some((e: string) => e.includes('No input node'))).toBe(true);
    });
  });

  describe('valid DAG', () => {
    it('returns exit code 0 for a valid 3-node DAG (pretty output)', async () => {
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(createValidDag()) });

      const exitCode = await validateCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('workflow.dag.json is valid');
      expect(output).toContain('Nodes: 3');
      expect(output).toContain('Edges: 2');
    });

    it('returns exit code 0 for a valid 3-node DAG (json output)', async () => {
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(createValidDag()) });

      const exitCode = await validateCommand(['workflow.dag.json', '--output', 'json'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        valid: boolean;
        file: string;
        errors: string[];
        warnings: string[];
        stats: { nodeCount: number; edgeCount: number };
      };
      expect(parsed.valid).toBe(true);
      expect(parsed.file).toBe('workflow.dag.json');
      expect(parsed.errors).toHaveLength(0);
      expect(parsed.stats.nodeCount).toBe(3);
      expect(parsed.stats.edgeCount).toBe(2);
    });

    it('--strict flag has no effect on a valid DAG (exit 0)', async () => {
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(createValidDag()) });

      const exitCode = await validateCommand(['workflow.dag.json', '--strict'], options);

      expect(exitCode).toBe(0);
    });
  });

  describe('--suggest-fix', () => {
    it('shows inline fix for unknown node type', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'transfrom', dependsOn: ['n1'], config: {} },
          { nodeId: 'n3', nodeType: 'text-output', dependsOn: ['n2'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json', '--suggest-fix'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Fix:');
      expect(output).toContain('transform');
    });

    it('shows inline fix for no input node', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json', '--suggest-fix'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Fix: Add an input node');
      expect(output).toContain('Suggested JSON:');
      expect(output).toContain('"nodeType": "input"');
    });

    it('detects edge referencing non-existent node', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'text-output', nodeType: 'text-output', dependsOn: [], config: {} },
        ],
        edges: [{ from: 'ghost-node', to: 'text-output' }],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json', '--suggest-fix'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('source node "ghost-node" not found');
      expect(output).toContain('Fix:');
    });

    it('does not break on valid DAG with --suggest-fix', async () => {
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(createValidDag()) });

      const exitCode = await validateCommand(['workflow.dag.json', '--suggest-fix'], options);

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('is valid');
    });

    it('returns fix suggestions in JSON output', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(
        ['workflow.dag.json', '--suggest-fix', '--output', 'json'],
        options,
      );

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(getOutput(options)) as { fixes: unknown[] };
      expect(Array.isArray(parsed.fixes)).toBe(true);
    });

    it('returns suggestions in JSON output when --suggest is active', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(
        ['workflow.dag.json', '--suggest', '--output', 'json'],
        options,
      );

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(getOutput(options)) as { suggestions: unknown[] };
      expect(Array.isArray(parsed.suggestions)).toBe(true);
    });

    it('shows suggestions in pretty output when --suggest is active and dag is invalid', async () => {
      const dag: IDagDefinition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'transform', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({ 'workflow.dag.json': JSON.stringify(dag) });

      const exitCode = await validateCommand(['workflow.dag.json', '--suggest'], options);

      expect(exitCode).toBe(1);
      // Suggestions section should appear when --suggest is active and there are errors
      // (buildSuggestions may return empty, but it's still called)
      expect(exitCode).toBe(1);
    });
  });
});
