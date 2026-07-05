import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('../studio/http-server.js', () => ({
  startStudioServer: vi.fn().mockResolvedValue({ port: 7777 } as never),
}));

vi.mock('../commands/run.js', () => ({
  applyEnvFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, cb: () => void) => {
    cb();
  }),
}));

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

  it('returns failure when startStudioServer throws', async () => {
    vi.mocked(startStudioServer).mockRejectedValue(new Error('all ports busy'));
    const io = makeIo();
    const code = await studioCommand([], { io });
    expect(code).toBe(1);
    expect(io.writeError).toHaveBeenCalledWith(expect.stringContaining('all ports busy'));
  });
});
