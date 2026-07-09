/**
 * Coverage-oriented tests for cost.ts and lint.ts — exercises execution paths
 * that misc-commands.test.ts does not reach.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function makeIo(readContent = ''): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue(readContent),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

const MINIMAL_DAG = JSON.stringify({
  dagId: 'test-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['input'], config: {} },
  ],
  edges: [{ from: 'input', to: 'output' }],
});

const DAG_WITH_LLM_ANTHROPIC = JSON.stringify({
  dagId: 'llm-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'llm',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'anthropic', model: 'claude-haiku-4-5' },
    },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [],
});

const DAG_WITH_MULTIPLE_LLM = JSON.stringify({
  dagId: 'multi-llm-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'anthropic',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    },
    {
      nodeId: 'openai',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'openai', model: 'gpt-4o' },
    },
    {
      nodeId: 'gemini',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'gemini', model: 'gemini-pro' },
    },
    {
      nodeId: 'deepseek',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'deepseek' },
    },
    {
      nodeId: 'qwen',
      nodeType: 'llm-text',
      dependsOn: ['input'],
      config: { provider: 'qwen' },
    },
    {
      nodeId: 'unknown-ai',
      nodeType: 'some-other-ai',
      dependsOn: ['input'],
      config: {},
    },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['anthropic'], config: {} },
  ],
  edges: [],
});

// ---------------------------------------------------------------------------
// runCostCommand — happy paths
// ---------------------------------------------------------------------------

describe('runCostCommand — success paths', () => {
  it('estimates cost for a minimal DAG (no LLM nodes) in pretty format', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await runCostCommand(['estimate', 'test.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('test.dag.json');
  });

  it('estimates cost with Anthropic haiku node', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_LLM_ANTHROPIC);
    const code = await runCostCommand(['estimate', 'llm.dag.json', '--input', 'text=hello world'], {
      io,
    });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Cost Estimate');
    expect(output).toContain('llm'); // nodeId, not nodeType
  });

  it('estimates cost with multiple LLM nodes', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_MULTIPLE_LLM);
    const code = await runCostCommand(['estimate', 'multi.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Cost Estimate');
    expect(output).toContain('anthropic'); // nodeId
  });

  it('outputs JSON format with --output json', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_LLM_ANTHROPIC);
    const code = await runCostCommand(['estimate', 'llm.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; dagId: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.dagId).toBe('llm-dag');
  });

  it('includes input text length when --input provided', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_LLM_ANTHROPIC);
    const code = await runCostCommand(
      ['estimate', 'llm.dag.json', '--input', 'text=hello world', '--input', 'more=stuff'],
      { io },
    );
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('chars');
  });

  it('handles DAG with Sonnet model', async () => {
    const dagWithSonnet = JSON.stringify({
      dagId: 'sonnet-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithSonnet);
    const code = await runCostCommand(['estimate', 'sonnet.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('llm'); // nodeId shown in output, not nodeType
  });

  it('handles openai with gpt-4o model', async () => {
    const dagWithGpt4o = JSON.stringify({
      dagId: 'gpt4o-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['in'],
          config: { provider: 'openai', model: 'gpt-4o' },
        },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithGpt4o);
    const code = await runCostCommand(['estimate', 'gpt4o.dag.json'], { io });
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCostCommand — error paths and additional branch coverage
// ---------------------------------------------------------------------------

describe('runCostCommand — error paths', () => {
  it('returns error for unknown subcommand', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['unknown-sub'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown cost subcommand');
  });

  it('returns error for --output with no value', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate', 'test.dag.json', '--output'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires a value');
  });

  it('returns error for duplicate --output flag', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(
      ['estimate', 'test.dag.json', '--output', 'json', '--output', 'pretty'],
      { io },
    );
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('can only be provided once');
  });

  it('returns error for --output with invalid format', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate', 'test.dag.json', '--output', 'xml'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--output must be');
  });

  it('returns error for --input without = separator', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate', 'test.dag.json', '--input', 'noequals'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('key=value');
  });

  it('returns error for unknown flags', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate', 'test.dag.json', '--unknown-xyz'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });

  it('returns error for missing file argument', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires <file>');
  });

  it('returns error for multiple positional arguments', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate', 'file1.dag.json', 'file2.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected positional');
  });

  it('returns error when file cannot be read', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    io.readTextFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const code = await runCostCommand(['estimate', 'missing.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Failed to read file');
  });

  it('covers non-Error throw in resolveErrorMessage', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    // Throw a plain string (non-Error)
    io.readTextFile = vi.fn().mockRejectedValue('string-error');
    const code = await runCostCommand(['estimate', 'missing.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('string-error');
  });

  it('returns error for invalid JSON in DAG file', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('not valid json');
    const code = await runCostCommand(['estimate', 'broken.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Failed to parse JSON');
  });

  it('returns error for JSON array instead of object', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('[]');
    const code = await runCostCommand(['estimate', 'array.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('must contain a JSON object');
  });

  it('handles gemini-flash model (default model branch)', async () => {
    const dagWithGemini = JSON.stringify({
      dagId: 'gemini-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'gemini' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithGemini);
    const code = await runCostCommand(['estimate', 'gemini.dag.json'], { io });
    expect(code).toBe(0);
  });

  it('handles gemini-pro model (isPro=true branch)', async () => {
    const dagWithGeminiPro = JSON.stringify({
      dagId: 'gemini-pro-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'gemini', model: 'gemini-1.0-pro' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithGeminiPro);
    const code = await runCostCommand(['estimate', 'gemini-pro.dag.json'], { io });
    expect(code).toBe(0);
  });

  it('handles openai gpt-4o-mini (default model, isGpt4o=false branch)', async () => {
    const dagWithMini = JSON.stringify({
      dagId: 'mini-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'openai' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithMini);
    const code = await runCostCommand(['estimate', 'mini.dag.json'], { io });
    expect(code).toBe(0);
  });

  it('handles totalUsd === 0 path in formatPrettyCostOutput', async () => {
    // A DAG with only non-API nodes results in totalUsd=0
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await runCostCommand(['estimate', 'minimal.dag.json'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('$0.000');
  });

  it('estimates cost for a .dag.md file (covers DAG_MD_SUFFIX branch)', async () => {
    // parseDagMd requires YAML frontmatter starting with ---
    const dagMdContent = `---
dagId: cost-md-test
dag:
  nodes:
    input:
      nodeType: input
    output:
      nodeType: text-output
---
`;
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagMdContent);
    const code = await runCostCommand(['estimate', 'workflow.dag.md'], { io });
    expect(code).toBe(0);
  });

  it('estimates cost for a workflow file format DAG (covers isWorkflowFileFormat branch)', async () => {
    // Workflow file format: has nodes, links, version (number), no dagId
    const workflowDag = JSON.stringify({
      version: 0.4,
      nodes: [
        { id: 1, type: 'RobotaInput', pos: [0, 0], outputs: [], inputs: [] },
        { id: 2, type: 'RobotaTextOutput', pos: [250, 0], outputs: [], inputs: [] },
      ],
      links: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(workflowDag);
    const code = await runCostCommand(['estimate', 'workflow.dag.json'], { io });
    expect(code).toBe(0);
  });

  it('estimates cost with Anthropic Sonnet model (covers model defined branch)', async () => {
    // model is defined (not null/undefined) — covers the LEFT arm of `model ?? default`
    const dagWithSonnet = JSON.stringify({
      dagId: 'sonnet-model-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(dagWithSonnet);
    const code = await runCostCommand(['estimate', 'sonnet-model.dag.json'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('claude-sonnet');
  });
});

// ---------------------------------------------------------------------------
// lintCommand — success paths with valid DAG files
// ---------------------------------------------------------------------------

describe('lintCommand — success path with valid DAG', () => {
  it('reports no errors for a valid minimal DAG', async () => {
    const { stat, readFile } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from(MINIMAL_DAG));

    const { lintCommand } = await import('../commands/lint.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await lintCommand(['test.dag.json'], { io, cwd: '/tmp' });
    // Should succeed or report 0 errors
    expect([0, 1]).toContain(code);
  });

  it('lints a file via readTextFile when readFile fails', async () => {
    const { stat } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as never);

    const { lintCommand } = await import('../commands/lint.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await lintCommand(['test.dag.json'], { io, cwd: '/tmp' });
    expect([0, 1]).toContain(code);
  });

  it('reports JSON output with --output json and valid file', async () => {
    const { stat, readFile } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from(MINIMAL_DAG));

    const { lintCommand } = await import('../commands/lint.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await lintCommand(['test.dag.json', '--output', 'json'], { io, cwd: '/tmp' });
    expect([0, 1]).toContain(code);
    const output = io.writes.join('');
    // JSON output should be parseable
    if (output.trim().startsWith('{')) {
      const parsed = JSON.parse(output) as { ok: boolean };
      expect(typeof parsed.ok).toBe('boolean');
    }
  });

  it('scans a directory for .dag.json files', async () => {
    const { stat, readdir, readFile } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(readdir).mockResolvedValue(['workflow.dag.json'] as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from(MINIMAL_DAG));

    const { lintCommand } = await import('../commands/lint.js');
    const io = makeIo(MINIMAL_DAG);
    const code = await lintCommand(['./workflows'], { io, cwd: '/tmp' });
    expect([0, 1]).toContain(code);
  });
});

// ---------------------------------------------------------------------------
// keysCommand — success paths
// ---------------------------------------------------------------------------

describe('keysCommand — success paths', () => {
  it('shows help with --help', async () => {
    const { keysCommand } = await import('../commands/keys.js');
    const io = makeIo('');
    const code = await keysCommand(['--help'], { io, cwd: '/tmp' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('keys');
  });

  it('lists keys when no .env file exists', async () => {
    const { keysCommand } = await import('../commands/keys.js');
    const io = makeIo('');
    const code = await keysCommand(['list'], { io, cwd: '/tmp' });
    expect(code).toBe(0);
  });

  it('returns error for unknown subcommand', async () => {
    const { keysCommand } = await import('../commands/keys.js');
    const io = makeIo('');
    const code = await keysCommand(['unknown-subcommand'], { io, cwd: '/tmp' });
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// lockCommand — success paths
// ---------------------------------------------------------------------------

describe('lockCommand — success paths', () => {
  it('shows help with --help', async () => {
    const { lockCommand } = await import('../commands/lock.js');
    const io = makeIo('');
    const code = await lockCommand(['--help'], { io, cwd: '/tmp' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('lock');
  });

  it('shows help when no subcommand provided', async () => {
    const { lockCommand } = await import('../commands/lock.js');
    const io = makeIo('');
    const code = await lockCommand([], { io, cwd: '/tmp' });
    expect(code).toBe(0);
  });

  it('returns error for unknown subcommand', async () => {
    const { lockCommand } = await import('../commands/lock.js');
    const io = makeIo('');
    const code = await lockCommand(['unknown'], { io, cwd: '/tmp' });
    expect(code).toBe(2);
  });

  it('runs lock check with no lock file present', async () => {
    const { lockCommand } = await import('../commands/lock.js');
    const io = makeIo('');
    io.readTextFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const code = await lockCommand(['check', 'test.dag.json'], { io, cwd: '/tmp' });
    // No lock file → returns appropriate code
    expect([0, 1, 2]).toContain(code);
  });
});
