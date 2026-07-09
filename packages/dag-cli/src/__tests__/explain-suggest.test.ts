import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { explainCommand } from '../commands/explain.js';
import type { IExplainCommandOptions } from '../commands/explain.js';

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
        },
        {
          nodeType: 'text-output',
          displayName: 'Text Output',
          inputs: [{ key: 'text', type: 'string' }],
          outputs: [],
        },
        {
          nodeType: 'llm-text',
          displayName: 'LLM',
          inputs: [{ key: 'text', type: 'string' }],
          outputs: [{ key: 'text', type: 'string' }],
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
          outputPayload: { text: { type: 'string', value: '⚡ Performance: use a faster model.' } },
        },
      ],
    }),
  })),
}));

vi.mock('../commands/run.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../commands/run.js')>();
  return {
    ...original,
    applyEnvFile: vi.fn().mockResolvedValue(undefined),
    extractFinalOutput: vi.fn(() => '⚡ Performance: use a faster model.'),
  };
});

vi.mock('@robota-sdk/dag-builder', () => ({
  isWorkflowFileFormat: vi.fn(() => false),
  fromDagWorkflowFile: vi.fn(),
}));

const VALID_DAG_JSON = JSON.stringify({
  dagId: 'test-pipeline',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'llm', nodeType: 'llm-text', dependsOn: ['input'], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'llm' },
    { from: 'llm', to: 'output' },
  ],
});

function createOptions(): IExplainCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async () => VALID_DAG_JSON,
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

describe('explainCommand --suggest', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('--help includes --suggest flag', async () => {
    const opts = createOptions();
    const code = await explainCommand(['--help'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('--suggest');
  });

  it('works without --suggest (baseline behavior unchanged)', async () => {
    const opts = createOptions();
    const code = await explainCommand(['pipeline.dag.json'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    expect(out).toContain('test-pipeline');
    expect(out).not.toContain('Suggestions');
  });

  it('appends suggestions section when --suggest is given and API key is set', async () => {
    const opts = createOptions();
    const code = await explainCommand(['pipeline.dag.json', '--suggest'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    expect(out).toContain('test-pipeline');
    expect(out).toContain('Suggestions');
    expect(out).toContain('Performance');
  });

  it('shows API key hint and exits 0 when --suggest is used without key', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const opts = createOptions();
    const code = await explainCommand(['pipeline.dag.json', '--suggest'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('ANTHROPIC_API_KEY');
  });

  it('rejects unknown flags', async () => {
    const opts = createOptions();
    const code = await explainCommand(['pipeline.dag.json', '--unknown'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('unexpected flags');
  });
});
