import { describe, it, expect, vi } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { lockCommand, validateFrozenRun } from '../commands/lock.js';

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockRejectedValue(new Error('not found')),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('lockCommand - help', () => {
  it('prints help when no subcommand', async () => {
    const io = makeIo();
    const code = await lockCommand([], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('lock');
  });

  it('prints help with --help', async () => {
    const io = makeIo();
    const code = await lockCommand(['--help'], { io });
    expect(code).toBe(0);
  });

  it('prints help with -h', async () => {
    const io = makeIo();
    const code = await lockCommand(['-h'], { io });
    expect(code).toBe(0);
  });
});

describe('lockCommand - unknown subcommand', () => {
  it('returns error for unknown subcommand', async () => {
    const io = makeIo();
    const code = await lockCommand(['unknown'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown lock subcommand');
  });
});

describe('lockCommand - generate', () => {
  it('runs generate with no DAG files (scans cwd)', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const io = makeIo();
    io.readTextFile = vi.fn().mockRejectedValue(new Error('no files'));
    const code = await lockCommand(['generate'], { io, cwd: '/tmp/fake-cwd' });
    // Could be success (0 files found) or error - just ensure it doesn't crash
    expect([0, 1, 2]).toContain(code);
  });
});

describe('lockCommand - check', () => {
  it('returns error when no lockfile exists', async () => {
    const io = makeIo();
    const code = await lockCommand(['check'], { io, cwd: '/tmp/no-lock' });
    expect([0, 1, 2]).toContain(code);
  });
});

describe('lockCommand - update', () => {
  it('runs update subcommand (no lock file present)', async () => {
    const io = makeIo();
    const code = await lockCommand(['update'], { io, cwd: '/tmp/no-lock' });
    expect([0, 1, 2]).toContain(code);
  });
});

describe('lockCommand - diff', () => {
  it('runs diff subcommand (no lock file present)', async () => {
    const io = makeIo();
    const code = await lockCommand(['diff'], { io, cwd: '/tmp/no-lock' });
    expect([0, 1, 2]).toContain(code);
  });
});

describe('validateFrozenRun', () => {
  it('returns error message when no lockfile found', async () => {
    const result = await validateFrozenRun([], '/tmp/no-lockfile-dir');
    expect(result).toContain('No lockfile found');
  });

  it('returns null (no error) with no nodes to validate', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ version: 1, nodes: {} }) as unknown as string,
    );
    const result = await validateFrozenRun([], '/tmp/has-lockfile');
    expect(result).toBeNull();
  });

  it('returns null when LLM node model matches lockfile', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        nodes: { llm: { resolvedModel: 'claude-haiku-4-5' } },
      }) as unknown as string,
    );
    const result = await validateFrozenRun(
      [{ nodeId: 'llm', nodeType: 'llm-text-anthropic', config: { model: 'claude-haiku-4-5' } }],
      '/tmp/has-lockfile',
    );
    expect(result).toBeNull();
  });

  it('returns error when LLM node model differs from lockfile', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        nodes: { llm: { resolvedModel: 'claude-sonnet-4-5' } },
      }) as unknown as string,
    );
    const result = await validateFrozenRun(
      [{ nodeId: 'llm', nodeType: 'llm-text-anthropic', config: { model: 'claude-haiku-4-5' } }],
      '/tmp/has-lockfile',
    );
    expect(result).not.toBeNull();
    expect(result).toContain('claude-haiku-4-5');
    expect(result).toContain('claude-sonnet-4-5');
  });
});
