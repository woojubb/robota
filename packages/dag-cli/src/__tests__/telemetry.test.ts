import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises to avoid actual file system reads/writes
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch to avoid actual network calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

import {
  readTelemetryConfig,
  isTelemetryEnabled,
  enableTelemetry,
  disableTelemetry,
  recordTelemetry,
} from '../telemetry.js';

describe('readTelemetryConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when config file does not exist', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const config = await readTelemetryConfig();
    expect(config).toEqual({});
  });

  it('returns empty object when config file contains invalid JSON', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('not-json' as unknown as string);
    const config = await readTelemetryConfig();
    expect(config).toEqual({});
  });

  it('returns empty object when config is an array', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('[]' as unknown as string);
    const config = await readTelemetryConfig();
    expect(config).toEqual({});
  });

  it('returns parsed config object', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify({ telemetryEnabled: true }) as unknown as string,
    );
    const config = await readTelemetryConfig();
    expect(config.telemetryEnabled).toBe(true);
  });
});

describe('isTelemetryEnabled', () => {
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

  it('returns false when CI=true', async () => {
    process.env['CI'] = 'true';
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('returns false when ROBOTA_DAG_TELEMETRY=0', async () => {
    process.env['ROBOTA_DAG_TELEMETRY'] = '0';
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('returns false when config has telemetryEnabled: false', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify({ telemetryEnabled: false }) as unknown as string,
    );
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('returns false when config file is missing (default off)', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('returns true when telemetryEnabled: true in config and no CI override', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify({ telemetryEnabled: true }) as unknown as string,
    );
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(true);
  });
});

describe('enableTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls writeFile to persist enabled=true', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    await enableTelemetry();
    expect(fsModule.writeFile).toHaveBeenCalled();
    const callArgs = vi.mocked(fsModule.writeFile).mock.calls[0];
    const writtenContent = callArgs?.[1] as string;
    const parsed = JSON.parse(writtenContent) as { telemetryEnabled: boolean };
    expect(parsed.telemetryEnabled).toBe(true);
  });
});

describe('disableTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls writeFile to persist enabled=false', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    await disableTelemetry();
    expect(fsModule.writeFile).toHaveBeenCalled();
    const callArgs = vi.mocked(fsModule.writeFile).mock.calls[0];
    const writtenContent = callArgs?.[1] as string;
    const parsed = JSON.parse(writtenContent) as { telemetryEnabled: boolean };
    expect(parsed.telemetryEnabled).toBe(false);
  });
});

describe('recordTelemetry', () => {
  const originalCI = process.env['CI'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['CI'];
  });

  afterEach(() => {
    if (originalCI !== undefined) process.env['CI'] = originalCI;
    else delete process.env['CI'];
  });

  it('does not call fetch when telemetry is disabled', async () => {
    process.env['CI'] = 'true';
    await recordTelemetry({ command: 'run', success: true, durationMs: 100 });
    // Allow fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch when telemetry is enabled', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValue(
      JSON.stringify({ telemetryEnabled: true }) as unknown as string,
    );

    await recordTelemetry({ command: 'run', success: true, durationMs: 200 });
    // Allow the fire-and-forget async block to execute
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalled();
  });

  it('silently swallows fetch errors', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValue(
      JSON.stringify({ telemetryEnabled: true }) as unknown as string,
    );
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      recordTelemetry({ command: 'run', success: false, durationMs: 50 }),
    ).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});
