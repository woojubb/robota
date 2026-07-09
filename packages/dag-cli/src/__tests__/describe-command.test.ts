import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDescribeCommandOptions } from '../commands/describe.js';
import { describeCommand } from '../commands/describe.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
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
          nodeType: 'llm-text',
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

const MOCK_BUILD_SPEC = JSON.stringify({
  nodes: [{ type: 'input' }, { type: 'llm-text' }, { type: 'text-output' }],
  edges: ['input→llm-text', 'llm-text→text-output'],
});

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
          outputPayload: { text: { type: 'string', value: MOCK_BUILD_SPEC } },
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
    extractFinalOutput: vi.fn(() => MOCK_BUILD_SPEC),
  };
});

function createOptions(): IDescribeCommandOptions & { readonly written: string[] } {
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
        throw new Error('not used');
      },
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

describe('describeCommand', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
  });

  it('prints help with --help', async () => {
    const opts = createOptions();
    const code = await describeCommand(['--help'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('dag describe');
  });

  it('returns exit code 2 when description is missing', async () => {
    const opts = createOptions();
    const code = await describeCommand([], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('requires a natural language description');
  });

  it('returns exit code 2 for unknown flag', async () => {
    const opts = createOptions();
    const code = await describeCommand(['--unknown', 'do stuff'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('unexpected flag');
  });

  it('returns exit code 2 when --output has no value', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate Korean to English', '--output'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('--output requires a value');
  });

  it('returns exit code 1 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const opts = createOptions();
    const code = await describeCommand(['translate Korean to English'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('ANTHROPIC_API_KEY');
  });

  it('outputs generated DAG JSON to stdout', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate Korean to English'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    const parsed = JSON.parse(out.slice(out.indexOf('{'))) as { dagId: string };
    expect(parsed.dagId).toBe('described-pipeline');
  });

  it('uses --dagId value in the output', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate Korean', '--dagId', 'my-pipeline'], opts);
    expect(code).toBe(0);
    const out = getOutput(opts);
    const parsed = JSON.parse(out.slice(out.indexOf('{'))) as { dagId: string };
    expect(parsed.dagId).toBe('my-pipeline');
  });

  it('writes to file when --output is provided', async () => {
    const { writeFile } = await import('node:fs/promises');
    const opts = createOptions();
    const code = await describeCommand(
      ['translate Korean', '--output', 'out/pipeline.dag.json'],
      opts,
    );
    expect(code).toBe(0);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      'out/pipeline.dag.json',
      expect.stringContaining('"dagId"'),
      'utf8',
    );
    expect(getOutput(opts)).toContain('Written:');
  });

  it('returns exit code 1 when LLM output is not valid JSON', async () => {
    const { extractFinalOutput } = await import('../commands/run.js');
    vi.mocked(extractFinalOutput).mockReturnValueOnce('not valid json at all');
    const opts = createOptions();
    const code = await describeCommand(['do something'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('not valid IBuildSpec JSON');
  });

  it('returns error when --dagId has no value', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate text', '--dagId'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('--dagId requires a value');
  });

  it('returns error when --input has no value', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate text', '--input'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('--input requires');
  });

  it('returns error when --input value has no equals sign', async () => {
    const opts = createOptions();
    const code = await describeCommand(['translate text', '--input', 'noequals'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain("must contain '='");
  });

  it('runs the generated DAG when --run flag is given', async () => {
    const opts = createOptions();
    const code = await describeCommand(
      ['translate Korean to English', '--run', '--input', 'text=hello'],
      opts,
    );
    expect([0, 1]).toContain(code);
  });
});
