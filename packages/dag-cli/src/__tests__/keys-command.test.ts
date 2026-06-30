import { describe, it, expect, vi } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockResolvedValue('' as unknown as string),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { keysCommand } from '../commands/keys.js';

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('keysCommand - help', () => {
  it('prints help when no args', async () => {
    const io = makeIo();
    const code = await keysCommand([], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('keys');
  });

  it('prints help with --help', async () => {
    const io = makeIo();
    const code = await keysCommand(['--help'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
  });

  it('prints help with -h', async () => {
    const io = makeIo();
    const code = await keysCommand(['-h'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
  });
});

describe('keysCommand - unknown subcommand', () => {
  it('returns error for unknown subcommand', async () => {
    const io = makeIo();
    const code = await keysCommand(['generate'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown keys subcommand');
  });
});

describe('keysCommand - list', () => {
  it('lists keys (empty env file)', async () => {
    const io = makeIo();
    const code = await keysCommand(['list'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Provider');
  });
});

describe('keysCommand - add', () => {
  it('returns error when no provider given to add', async () => {
    const io = makeIo();
    const code = await keysCommand(['add'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires a provider name');
  });
});

describe('keysCommand - test', () => {
  it('tests keys (none set, returns failure)', async () => {
    const io = makeIo();
    const code = await keysCommand(['test'], { io, cwd: '/tmp/fake' });
    expect([0, 1]).toContain(code);
    expect(io.writes.join('')).toContain('not set');
  });

  it('tests key with valid format (sk-ant- prefix)', async () => {
    const saved = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-validkeyformat12345678901234567890';
    const io = makeIo();
    const code = await keysCommand(['test'], { io, cwd: '/tmp/fake' });
    if (saved !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = saved;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
    expect([0, 1]).toContain(code);
    expect(io.writes.join('')).toContain('present');
  });

  it('tests key with invalid format (wrong prefix)', async () => {
    const saved = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'wrong-prefix-but-long-enough-12345678901234';
    const io = makeIo();
    const code = await keysCommand(['test'], { io, cwd: '/tmp/fake' });
    if (saved !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = saved;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
    expect([0, 1]).toContain(code);
    expect(io.writes.join('')).toContain('format');
  });
});

describe('keysCommand - remove', () => {
  it('returns error when no provider given', async () => {
    const io = makeIo();
    const code = await keysCommand(['remove'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires a provider name');
  });

  it('returns error for unknown provider', async () => {
    const io = makeIo();
    const code = await keysCommand(['remove', 'mysteryai'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown provider');
  });

  it('reports not set when removing a key that does not exist', async () => {
    const io = makeIo();
    const code = await keysCommand(['remove', 'anthropic'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('was not set');
  });
});
