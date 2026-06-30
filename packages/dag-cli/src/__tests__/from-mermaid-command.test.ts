import { describe, expect, it, vi } from 'vitest';
import type { IFromMermaidCommandOptions } from '../commands/from-mermaid.js';
import { fromMermaidCommand } from '../commands/from-mermaid.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@robota-sdk/dag-node', () => ({
  buildNodeDefinitionAssembly: vi.fn(() => ({
    ok: true,
    value: {
      manifests: [
        { nodeType: 'input', defaultOutputPort: 'text' },
        { nodeType: 'text-output', defaultInputPort: 'text' },
        { nodeType: 'transform', defaultInputPort: 'text', defaultOutputPort: 'text' },
      ],
    },
  })),
}));

vi.mock('../local-runner/index.js', () => ({
  createCliNodeRegistry: vi.fn(() => ({})),
  LocalDagRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      dagRun: { status: 'success' },
      taskRuns: [],
    }),
  })),
}));

vi.mock('../commands/run.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../commands/run.js')>();
  return { ...original, extractFinalOutput: vi.fn(() => 'hello output') };
});

import { mkdir, writeFile } from 'node:fs/promises';
import { LocalDagRunner } from '../local-runner/index.js';
import { extractFinalOutput } from '../commands/run.js';

function createOptions(
  overrides: Partial<IFromMermaidCommandOptions> = {},
): IFromMermaidCommandOptions & {
  readonly written: string[];
} {
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
        throw new Error('readTextFile not mocked');
      },
      writeBinaryStream: async () => {
        // not used
      },
      ...overrides.io,
    },
    written,
  };
}

function getOutput(opts: { readonly written: string[] }): string {
  return opts.written.join('');
}

const SIMPLE_MERMAID = `flowchart LR
  A[input] --> B[transform]
  B --> C[text-output]`;

describe('fromMermaidCommand', () => {
  it('prints help with --help', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand(['--help'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('dag from-mermaid');
  });

  it('returns exit code 2 when source is missing', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('requires a Mermaid string');
  });

  it('returns exit code 2 for unknown flag', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand(['--unknown', SIMPLE_MERMAID], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('unexpected flag');
  });

  it('returns exit code 2 when --output has no value', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--output'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain('--output requires a value');
  });

  it('prints JSON to stdout for inline mermaid without --output', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID], opts);
    expect(code).toBe(0);
    const output = getOutput(opts);
    const parsed = JSON.parse(output) as { dagId: string; nodes: unknown[]; edges: unknown[] };
    expect(parsed.dagId).toBe('from-mermaid');
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes.length).toBeGreaterThan(0);
  });

  it('writes file when --output is provided', async () => {
    vi.mocked(writeFile).mockResolvedValueOnce(undefined);
    const opts = createOptions();
    const code = await fromMermaidCommand(
      [SIMPLE_MERMAID, '--output', 'out/result.dag.json'],
      opts,
    );
    expect(code).toBe(0);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      'out/result.dag.json',
      expect.stringContaining('"dagId"'),
      'utf8',
    );
    expect(getOutput(opts)).toContain('Written: out/result.dag.json');
  });

  it('creates parent directory before writing', async () => {
    vi.mocked(mkdir).mockResolvedValueOnce(undefined);
    vi.mocked(writeFile).mockResolvedValueOnce(undefined);
    const opts = createOptions();
    await fromMermaidCommand([SIMPLE_MERMAID, '--output', 'some/dir/result.dag.json'], opts);
    expect(vi.mocked(mkdir)).toHaveBeenCalledWith('some/dir', { recursive: true });
  });

  it('uses --dagId value in the output JSON', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--dagId', 'my-workflow'], opts);
    expect(code).toBe(0);
    const parsed = JSON.parse(getOutput(opts)) as { dagId: string };
    expect(parsed.dagId).toBe('my-workflow');
  });

  it('returns exit code 1 for unknown node type in mermaid', async () => {
    const opts = createOptions();
    const mermaid = 'flowchart LR\n  A[unknown-node-xyz] --> B[input]';
    const code = await fromMermaidCommand([mermaid], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('Unknown node type');
  });

  it('reads mermaid block from .dag.md file', async () => {
    const fileContent = `# My workflow\n\n\`\`\`mermaid\n${SIMPLE_MERMAID}\n\`\`\`\n`;
    const opts = createOptions({
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: async () => fileContent,
        writeBinaryStream: async () => {
          // not used
        },
      },
    });
    const code = await fromMermaidCommand(['workflow.dag.md'], opts);
    expect(code).toBe(0);
    const parsed = JSON.parse(getOutput(opts)) as { nodes: unknown[] };
    expect(Array.isArray(parsed.nodes)).toBe(true);
  });

  it('returns exit code 1 when .dag.md file is not found', async () => {
    const opts = createOptions({
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: async () => {
          throw new Error('ENOENT');
        },
        writeBinaryStream: async () => {
          // not used
        },
      },
    });
    const code = await fromMermaidCommand(['missing.dag.md'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('Failed to read file');
  });

  it('returns exit code 1 when .dag.md has no mermaid block', async () => {
    const opts = createOptions({
      io: {
        write: (t) => {
          opts.written.push(t);
        },
        writeError: (t) => {
          opts.written.push(t);
        },
        readTextFile: async () => '# No mermaid here\nJust text.',
        writeBinaryStream: async () => {
          // not used
        },
      },
    });
    const code = await fromMermaidCommand(['workflow.dag.md'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('No mermaid code block found');
  });

  it('runs the dag and returns output when --run is provided', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--run'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('hello output');
  });

  it('returns exit code 2 when --input value has no = sign', async () => {
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--input', 'noequalssign'], opts);
    expect(code).toBe(2);
    expect(getOutput(opts)).toContain("must contain '='");
  });

  it('returns exit code 1 when runner throws during --run', async () => {
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () => ({ run: vi.fn().mockRejectedValue(new Error('runner crashed')) }) as never,
    );
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--run'], opts);
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
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--run'], opts);
    expect(code).toBe(1);
    expect(getOutput(opts)).toContain('did not succeed');
  });

  it('shows ✓ Run completed when extractFinalOutput returns null during --run', async () => {
    vi.mocked(extractFinalOutput).mockReturnValueOnce(null);
    const opts = createOptions();
    const code = await fromMermaidCommand([SIMPLE_MERMAID, '--run'], opts);
    expect(code).toBe(0);
    expect(getOutput(opts)).toContain('Run completed');
  });
});
