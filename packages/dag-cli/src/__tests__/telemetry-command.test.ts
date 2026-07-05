import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../telemetry.js', () => ({
  readTelemetryConfig: vi.fn().mockResolvedValue({}),
  enableTelemetry: vi.fn().mockResolvedValue(undefined),
  disableTelemetry: vi.fn().mockResolvedValue(undefined),
  isTelemetryEnabled: vi.fn().mockResolvedValue(false),
}));

import { telemetryCommand } from '../commands/telemetry.js';
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

describe('telemetryCommand', () => {
  const originalCI = process.env['CI'];
  const originalOpt = process.env['ROBOTA_DAG_TELEMETRY'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['CI'];
    delete process.env['ROBOTA_DAG_TELEMETRY'];
  });

  afterEach(() => {
    if (originalCI !== undefined) process.env['CI'] = originalCI;
    else delete process.env['CI'];
    if (originalOpt !== undefined) process.env['ROBOTA_DAG_TELEMETRY'] = originalOpt;
    else delete process.env['ROBOTA_DAG_TELEMETRY'];
  });

  it('shows help text when no subcommand is given', async () => {
    const io = makeMockIo();
    const code = await telemetryCommand([], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag telemetry');
  });

  it('shows help text with --help flag', async () => {
    const io = makeMockIo();
    const code = await telemetryCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag telemetry');
  });

  it('shows help text with -h flag', async () => {
    const io = makeMockIo();
    const code = await telemetryCommand(['-h'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag telemetry');
  });

  it('returns error for unknown subcommand', async () => {
    const io = makeMockIo();
    const code = await telemetryCommand(['unknown-sub'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Unknown telemetry subcommand');
  });

  describe('status subcommand', () => {
    it('shows disabled in CI when CI=true', async () => {
      process.env['CI'] = 'true';
      const io = makeMockIo();
      const code = await telemetryCommand(['status'], { io });
      expect(code).toBe(0);
      expect(io.written.join('')).toContain('CI environment');
    });

    it('shows disabled when ROBOTA_DAG_TELEMETRY=0', async () => {
      process.env['ROBOTA_DAG_TELEMETRY'] = '0';
      const io = makeMockIo();
      const code = await telemetryCommand(['status'], { io });
      expect(code).toBe(0);
      expect(io.written.join('')).toContain('ROBOTA_DAG_TELEMETRY=0');
    });

    it('shows disabled when config has telemetryEnabled: false', async () => {
      const telemetry = await import('../telemetry.js');
      vi.mocked(telemetry.readTelemetryConfig).mockResolvedValueOnce({
        telemetryEnabled: false,
      });
      const io = makeMockIo();
      const code = await telemetryCommand(['status'], { io });
      expect(code).toBe(0);
      expect(io.written.join('')).toContain('disabled');
    });

    it('shows enabled when config has telemetryEnabled: true', async () => {
      const telemetry = await import('../telemetry.js');
      vi.mocked(telemetry.readTelemetryConfig).mockResolvedValueOnce({
        telemetryEnabled: true,
      });
      const io = makeMockIo();
      const code = await telemetryCommand(['status'], { io });
      expect(code).toBe(0);
      expect(io.written.join('')).toContain('enabled');
    });
  });

  describe('on subcommand', () => {
    it('returns error in CI environment', async () => {
      process.env['CI'] = 'true';
      const io = makeMockIo();
      const code = await telemetryCommand(['on'], { io });
      expect(code).not.toBe(0);
      expect(io.written.join('')).toContain('CI');
    });

    it('returns error when ROBOTA_DAG_TELEMETRY=0', async () => {
      process.env['ROBOTA_DAG_TELEMETRY'] = '0';
      const io = makeMockIo();
      const code = await telemetryCommand(['on'], { io });
      expect(code).not.toBe(0);
    });

    it('calls enableTelemetry and returns 0 in normal env', async () => {
      const telemetry = await import('../telemetry.js');
      const io = makeMockIo();
      const code = await telemetryCommand(['on'], { io });
      expect(code).toBe(0);
      expect(telemetry.enableTelemetry).toHaveBeenCalled();
    });
  });

  describe('off subcommand', () => {
    it('calls disableTelemetry and returns 0', async () => {
      const telemetry = await import('../telemetry.js');
      const io = makeMockIo();
      const code = await telemetryCommand(['off'], { io });
      expect(code).toBe(0);
      expect(telemetry.disableTelemetry).toHaveBeenCalled();
      expect(io.written.join('')).toContain('disabled');
    });
  });
});
