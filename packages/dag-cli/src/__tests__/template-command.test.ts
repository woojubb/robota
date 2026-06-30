import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../commands/run.js', () => ({
  runCommand: vi.fn().mockResolvedValue(0),
  applyEnvFile: vi.fn().mockResolvedValue(undefined),
  extractFinalOutput: vi.fn().mockReturnValue(null),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
}));

import { templateCommand } from '../commands/template.js';
import type { IDagCliIo } from '../types.js';

function makeMockIo(): IDagCliIo & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((msg: string) => {
      written.push(msg);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn(),
  };
}

describe('templateCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no subcommand is given', async () => {
    const io = makeMockIo();
    const code = await templateCommand([], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Usage');
  });

  it('returns error for unknown subcommand', async () => {
    const io = makeMockIo();
    const code = await templateCommand(['unknown-sub'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Unknown template subcommand');
  });

  describe('list subcommand', () => {
    it('returns 0 and outputs template JSON array', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['list'], { io });
      expect(code).toBe(0);
      const output = io.written.join('');
      const parsed = JSON.parse(output) as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });
  });

  describe('info subcommand', () => {
    it('returns error when id is not given', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['info'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('Usage');
    });

    it('returns error for unknown template id', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['info', 'no-such-template'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('Unknown template');
    });

    it('returns 0 and outputs template JSON for known id', async () => {
      const io = makeMockIo();
      // Get the actual list first to find a valid id
      const listIo = makeMockIo();
      await templateCommand(['list'], { io: listIo });
      const templates = JSON.parse(listIo.written.join('')) as Array<{ id: string }>;
      const validId = templates[0]?.id ?? 'linear';

      const code = await templateCommand(['info', validId], { io });
      expect(code).toBe(0);
      const output = io.written.join('');
      const parsed = JSON.parse(output) as { id: string };
      expect(parsed.id).toBe(validId);
    });
  });

  describe('run subcommand', () => {
    it('returns error when id is not given', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['run'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('Usage');
    });

    it('returns error when --slot has no value', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['run', 'linear', '--slot'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('--slot requires');
    });

    it('returns error when --slot value has no = sign', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['run', 'linear', '--slot', 'noequalssign'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('key=value');
    });

    it('returns error for unknown template id', async () => {
      const io = makeMockIo();
      const code = await templateCommand(['run', 'no-such-template'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('Error');
    });
  });

  it('uses default io when options.io is not provided', async () => {
    // Should not throw even without io provided (uses process.stdout/stderr)
    const originalWrite = process.stdout.write.bind(process.stdout);
    const written: string[] = [];
    process.stdout.write = vi.fn((chunk) => {
      written.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      const code = await templateCommand(['list']);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
