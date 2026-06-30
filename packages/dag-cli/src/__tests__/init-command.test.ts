import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDagCliIo } from '../types.js';

// Mock fs/promises to avoid real filesystem writes
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')), // files don't exist by default
}));

import { initCommand } from '../commands/init.js';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';

function makeIo(): { io: IDagCliIo; output: string[] } {
  const output: string[] = [];
  const io: IDagCliIo = {
    write: (t) => {
      output.push(t);
    },
    writeError: (t) => {
      output.push(t);
    },
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn(),
  };
  return { io, output };
}

describe('initCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
  });

  it('returns 0 on success with default args', async () => {
    const { io, output } = makeIo();
    const code = await initCommand([], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('Initialized dag project');
  });

  it('creates expected files', async () => {
    const { io } = makeIo();
    await initCommand([], { io });
    expect(writeFile).toHaveBeenCalledTimes(5);
    const paths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    expect(paths.some((p) => p.includes('hello-world.dag.json'))).toBe(true);
    expect(paths.some((p) => p.includes('hello-world.dag.md'))).toBe(true);
    expect(paths.some((p) => p.includes('.env.example'))).toBe(true);
    expect(paths.some((p) => p.includes('README-DAG.md'))).toBe(true);
    expect(paths.some((p) => p.includes('.gitignore'))).toBe(true);
  });

  it('uses custom directory', async () => {
    const { io } = makeIo();
    await initCommand(['my-project'], { io });
    const paths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    expect(paths.every((p) => p.startsWith('my-project'))).toBe(true);
  });

  it('uses openai provider when --provider openai', async () => {
    const { io } = makeIo();
    await initCommand(['--provider', 'openai'], { io });
    const dagCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('hello-world.dag.json'));
    expect(dagCall).toBeDefined();
    const content = dagCall![1] as string;
    expect(content).toContain('llm-text-openai');
  });

  it('returns 2 for unknown --provider', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--provider', 'bad-provider'], { io });
    expect(code).toBe(2);
    expect(output.join('')).toContain('Unknown provider');
  });

  it('returns 2 for unknown --template', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--template', 'bad-template'], { io });
    expect(code).toBe(2);
    expect(output.join('')).toContain('Unknown template');
  });

  it('skips existing files', async () => {
    vi.mocked(access).mockResolvedValue(undefined); // all paths exist
    const { io, output } = makeIo();
    await initCommand([], { io });
    expect(writeFile).not.toHaveBeenCalled();
    expect(output.join('')).toContain('skipped, already exists');
  });

  it('generates anthropic env example by default', async () => {
    const { io } = makeIo();
    await initCommand([], { io });
    const envCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.env.example'));
    expect(envCall![1] as string).toContain('ANTHROPIC_API_KEY=');
  });

  it('shows help with --help', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('dag init');
  });

  it('shows help with -h', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['-h'], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('dag init');
  });

  it('returns 2 when --template has no value', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--template'], { io });
    expect(code).toBe(2);
    expect(output.join('')).toContain('--template requires');
  });

  it('returns 2 when --provider has no value', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--provider'], { io });
    expect(code).toBe(2);
    expect(output.join('')).toContain('--provider requires');
  });

  it('uses gemini provider when --provider gemini', async () => {
    const { io } = makeIo();
    await initCommand(['--provider', 'gemini'], { io });
    const envCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.env.example'));
    expect(envCall![1] as string).toContain('GEMINI_API_KEY=');
    const dagCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('hello-world.dag.json'));
    expect(dagCall![1] as string).toContain('llm-text-gemini');
  });

  it('shows template note for non-hello-world template', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--template', 'code-review'], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('not yet implemented');
  });

  it('uses --no-cta flag to suppress CTA', async () => {
    const { io, output } = makeIo();
    const originalCi = process.env['CI'];
    delete process.env['CI'];
    const code = await initCommand(['--no-cta'], { io });
    process.env['CI'] = originalCi;
    expect(code).toBe(0);
    expect(output.join('')).toContain('Next steps');
  });

  it('shows simplified next steps when CI=true', async () => {
    const { io, output } = makeIo();
    const originalCi = process.env['CI'];
    process.env['CI'] = 'true';
    const code = await initCommand([], { io });
    if (originalCi !== undefined) {
      process.env['CI'] = originalCi;
    } else {
      delete process.env['CI'];
    }
    expect(code).toBe(0);
    expect(output.join('')).toContain('Next steps');
  });

  it('shows warning when .dag dir already exists', async () => {
    vi.mocked(access).mockImplementation(async (p: unknown) => {
      if (typeof p === 'string' && p.endsWith('.dag')) {
        return undefined; // .dag exists
      }
      throw new Error('ENOENT');
    });
    const { io, output } = makeIo();
    const code = await initCommand([], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('already exists');
  });

  it('writes mcp.json when --claude flag is used', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--claude'], { io });
    expect(code).toBe(0);
    const allOutput = output.join('');
    expect(allOutput).toContain('mcp.json');
    const paths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    expect(paths.some((p) => p.includes('mcp.json'))).toBe(true);
  });

  it('merges with existing valid mcp.json when --claude flag is used', async () => {
    const existingMcp = JSON.stringify({ mcpServers: { other: { command: 'node', args: [] } } });
    vi.mocked(access).mockImplementation(async (p: unknown) => {
      if (typeof p === 'string' && p.includes('mcp.json')) {
        return undefined; // mcp.json exists
      }
      throw new Error('ENOENT');
    });
    vi.mocked(readFile).mockResolvedValueOnce(existingMcp as unknown as string);
    const { io } = makeIo();
    const code = await initCommand(['--claude'], { io });
    expect(code).toBe(0);
    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('mcp.json'));
    expect(mcpCall).toBeDefined();
    const written = mcpCall![1] as string;
    expect(written).toContain('robota-dag');
    expect(written).toContain('other'); // existing entry preserved
  });

  it('resets malformed mcp.json when --claude flag is used', async () => {
    vi.mocked(access).mockImplementation(async (p: unknown) => {
      if (typeof p === 'string' && p.includes('mcp.json')) {
        return undefined; // mcp.json exists
      }
      throw new Error('ENOENT');
    });
    vi.mocked(readFile).mockResolvedValueOnce('not valid json' as unknown as string);
    const { io } = makeIo();
    const code = await initCommand(['--claude'], { io });
    expect(code).toBe(0);
    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('mcp.json'));
    expect(mcpCall).toBeDefined();
    expect(mcpCall![1] as string).toContain('robota-dag');
  });

  it('writes team files when --team flag is used', async () => {
    const { io, output } = makeIo();
    const code = await initCommand(['--team'], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('Initializing team setup');
    const paths = vi.mocked(writeFile).mock.calls.map((c) => c[0] as string);
    expect(paths.some((p) => p.includes('lint.json'))).toBe(true);
    expect(paths.some((p) => p.includes('dag-ci.yml'))).toBe(true);
  });

  it('skips existing team files when --team flag is used', async () => {
    vi.mocked(access).mockImplementation(async (p: unknown) => {
      if (typeof p === 'string' && p.includes('lint.json')) {
        return undefined; // lint.json exists
      }
      throw new Error('ENOENT');
    });
    const { io, output } = makeIo();
    const code = await initCommand(['--team'], { io });
    expect(code).toBe(0);
    expect(output.join('')).toContain('skipped');
  });
});
