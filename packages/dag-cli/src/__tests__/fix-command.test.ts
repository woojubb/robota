import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IFixCommandOptions } from '../commands/fix.js';
import { fixCommand } from '../commands/fix.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@robota-sdk/dag-node', () => ({
  buildNodeDefinitionAssembly: vi.fn(() => ({
    ok: true,
    value: {
      manifests: [
        {
          nodeType: 'input',
          displayName: 'Input',
          inputs: [],
          outputs: [{ key: 'text', type: 'string' }],
          defaultOutputPort: 'text',
        },
        {
          nodeType: 'text-output',
          displayName: 'Text Output',
          inputs: [{ key: 'text', type: 'string', required: true }],
          outputs: [],
          defaultInputPort: 'text',
        },
        {
          nodeType: 'llm-text-anthropic',
          displayName: 'LLM Anthropic',
          inputs: [{ key: 'text', type: 'string', required: true }],
          outputs: [{ key: 'text', type: 'string' }],
          defaultInputPort: 'text',
          defaultOutputPort: 'text',
        },
      ],
    },
  })),
}));

vi.mock('../local-runner/index.js', () => ({
  createCliNodeRegistry: vi.fn(() => ({})),
  LocalDagRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      dagRun: { status: 'success' },
      taskRuns: [
        {
          nodeId: 'output',
          nodeType: 'text-output',
          status: 'success',
          outputPayload: {
            text: {
              type: 'string',
              value: JSON.stringify({
                nodes: [{ type: 'input' }, { type: 'llm-text-anthropic' }, { type: 'text-output' }],
                edges: ['input→llm-text-anthropic', 'llm-text-anthropic→text-output'],
              }),
            },
          },
        },
      ],
    }),
  })),
}));

vi.mock('@robota-sdk/dag-builder', () => ({
  isWorkflowFileFormat: vi.fn(() => false),
  fromDagWorkflowFile: vi.fn(),
}));

import { LocalDagRunner } from '../local-runner/index.js';
import { extractFinalOutput } from '../commands/run.js';

vi.mock('../commands/run.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../commands/run.js')>();
  return {
    ...original,
    applyEnvFile: vi.fn().mockResolvedValue(undefined),
    extractFinalOutput: vi.fn(() =>
      JSON.stringify({
        nodes: [{ type: 'input' }, { type: 'llm-text-anthropic' }, { type: 'text-output' }],
        edges: ['input→llm-text-anthropic', 'llm-text-anthropic→text-output'],
      }),
    ),
  };
});

import { writeFile } from 'node:fs/promises';

const VALID_DAG = JSON.stringify({
  dagId: 'test',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'llm', nodeType: 'llm-text-anthropic', dependsOn: ['input'], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'llm' },
    { from: 'llm', to: 'output' },
  ],
});

const BROKEN_DAG = JSON.stringify({
  dagId: 'broken',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'bad', nodeType: 'nonexistent-node', dependsOn: ['input'], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['bad'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'bad' },
    { from: 'bad', to: 'output' },
  ],
});

function createOptions(fileContent: string): IFixCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async () => fileContent,
      writeBinaryStream: async () => {
        // not used
      },
    },
    written,
  };
}

function getOutput(opts: { readonly written: string[] }): string {
  return opts.written.join('');
}

describe('fixCommand', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('prints help with --help', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand(['--help'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('dag fix');
  });

  it('returns exit code 2 when file path is missing', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand([], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('requires a .dag.json file path');
  });

  it('returns exit code 2 for unknown flag', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand(['broken.dag.json', '--unknown'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('unexpected flag');
  });

  it('returns exit code 1 when file cannot be read', async () => {
    const opts = {
      ...createOptions(VALID_DAG),
      io: {
        write: (t: string) => {
          opts.written.push(t);
        },
        writeError: (t: string) => {
          opts.written.push(t);
        },
        readTextFile: async () => {
          throw new Error('ENOENT');
        },
        writeBinaryStream: async () => {
          // not used
        },
      },
    };
    const code = await fixCommand(['missing.dag.json'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('Failed to read');
  });

  it('reports no errors for a valid DAG', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand(['valid.dag.json'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('No errors found');
  });

  it('finds errors and prints fix suggestion for broken DAG', async () => {
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--no-llm'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    expect(out).toContain('error');
    expect(out).toContain('Suggested fix');
    expect(out).toContain('--apply');
  });

  it('applies fix and writes backup when --apply is given', async () => {
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--apply', '--no-llm'], opts);
    expect(code).toBe(0);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith('broken.dag.json.bak', BROKEN_DAG, 'utf8');
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      'broken.dag.json',
      expect.stringContaining('"dagId"'),
      'utf8',
    );
    expect(getOutput(opts)).toContain('Applied:');
  });

  it('uses LLM fix when ANTHROPIC_API_KEY is set', async () => {
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    expect(out).toContain('LLM');
  });

  it('shows static analysis hint when no API key and no --no-llm', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('ANTHROPIC_API_KEY');
  });

  it('returns error when --input has no value', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand(['file.dag.json', '--input'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('--input requires');
  });

  it('returns error when --input value has no equals sign', async () => {
    const opts = createOptions(VALID_DAG);
    const code = await fixCommand(['file.dag.json', '--input', 'noequalssign'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain("must contain '='");
  });

  it('accepts --run flag (builds and runs the fix)', async () => {
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--run', '--no-llm'], opts);
    expect([0, 1]).toContain(code);
  });

  it('returns exit code 1 when runner throws during --run', async () => {
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () => ({ run: vi.fn().mockRejectedValue(new Error('run crashed')) }) as never,
    );
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--run', '--no-llm'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('DAG run failed');
  });

  it('returns exit code 1 when dagRun status is not success during --run', async () => {
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({ dagRun: { status: 'failed' }, taskRuns: [] }),
        }) as never,
    );
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--run', '--no-llm'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('did not succeed');
  });

  it('shows ✓ Run completed when extractFinalOutput returns null during --run', async () => {
    vi.mocked(extractFinalOutput).mockReturnValueOnce(null);
    const opts = createOptions(BROKEN_DAG);
    const code = await fixCommand(['broken.dag.json', '--run', '--no-llm'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('Run completed');
  });
});
