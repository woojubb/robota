import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('../studio/http-server.js', () => ({
  startStudioServer: vi.fn().mockResolvedValue({ port: 7777 } as never),
}));

vi.mock('../commands/run.js', () => ({
  applyEnvFile: vi.fn().mockResolvedValue(undefined),
}));

// SEC: the browser must be opened via `spawn` with an ARGV VECTOR (no shell string concatenation),
// so a crafted file path can never be interpreted as shell syntax.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn(),
  })),
}));

import { spawn } from 'node:child_process';
import { studioCommand } from '../commands/studio.js';
import { startStudioServer } from '../studio/http-server.js';

// Simulate SIGINT to unblock waitForSigint
function fireSigintNextTick(): void {
  setTimeout(() => {
    process.emit('SIGINT', 'SIGINT');
  }, 0);
}

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

describe('studioCommand', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
    vi.mocked(startStudioServer).mockResolvedValue({ port: 7777 } as never);
  });

  it('starts server and prints port/url then stops on SIGINT', async () => {
    const io = makeIo();
    fireSigintNextTick();
    const code = await studioCommand([], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('7777');
    expect(output).toContain('DAG Studio stopped');
  });

  it('passes file path in URL when positional arg provided', async () => {
    const io = makeIo();
    fireSigintNextTick();
    const code = await studioCommand(['my-dag.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('my-dag.dag.json');
  });

  it('uses custom --port when provided', async () => {
    vi.mocked(startStudioServer).mockResolvedValue({ port: 8888 } as never);
    const io = makeIo();
    fireSigintNextTick();
    const code = await studioCommand(['--port', '8888'], { io });
    expect(code).toBe(0);
    expect(startStudioServer).toHaveBeenCalledWith(8888, expect.anything());
  });

  it('returns failure for invalid port (non-numeric)', async () => {
    const io = makeIo();
    const code = await studioCommand(['--port', 'abc'], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('--port must be a valid port number');
  });

  it('returns failure for port out of range', async () => {
    const io = makeIo();
    const code = await studioCommand(['--port', '99999'], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('--port must be a valid port number');
  });

  // SEC: the browser-open must not build a shell command string. The URL (which embeds a
  // user-supplied file path) has to arrive as its own argv element, never concatenated into a
  // command line that a shell would parse.
  it('opens the browser with the URL as a separate argv element, not a shell string', async () => {
    const io = makeIo();
    fireSigintNextTick();
    await studioCommand([], { io });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = vi.mocked(spawn).mock.calls[0] as unknown as [string, string[]];
    const url = 'http://127.0.0.1:7777/';

    // The command is a bare executable name — it must not carry the URL or any quoting.
    expect(command).not.toContain(url);
    expect(command).not.toContain(' ');
    expect(command).not.toContain('"');

    // The URL is its own argv element, byte-for-byte, never embedded in a larger string.
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain(url);
    for (const arg of args) {
      expect(arg).not.toContain('"');
    }
  });

  it('passes a shell-metacharacter file path as an inert argv element', async () => {
    const io = makeIo();
    fireSigintNextTick();
    await studioCommand(['a";touch /tmp/dag-studio-pwned;"b.dag.json'], { io });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = vi.mocked(spawn).mock.calls[0] as unknown as [string, string[]];
    expect(command).not.toContain(';');
    for (const arg of args) {
      expect(arg).not.toContain(';touch ');
    }
    // The URL element is the last argument and is a single, complete URL.
    expect(args[args.length - 1]).toMatch(/^http:\/\/127\.0\.0\.1:7777\/\?file=/);
  });

  it('returns failure when startStudioServer throws', async () => {
    vi.mocked(startStudioServer).mockRejectedValue(new Error('all ports busy'));
    const io = makeIo();
    const code = await studioCommand([], { io });
    expect(code).toBe(1);
    expect(io.writeError).toHaveBeenCalledWith(expect.stringContaining('all ports busy'));
  });
});
