import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('node:net', () => ({
  createConnection: vi.fn(() => {
    const emitter = { on: vi.fn().mockReturnThis(), destroy: vi.fn() };
    // Simulate immediate connect
    setTimeout(() => {
      const connectCb = (emitter.on.mock.calls as Array<[string, () => void]>).find(
        ([ev]) => ev === 'connect',
      )?.[1];
      connectCb?.();
    }, 0);
    return emitter;
  }),
}));

import { existsSync, readFileSync } from 'node:fs';
import { runDiagnoseCommand } from '../startup/diagnose-command.js';
import type { IPreflightContext } from '../startup/preflight.js';

function makeCtx(overrides: Partial<IPreflightContext> = {}): IPreflightContext {
  const lines: string[] = [];
  return {
    version: '3.0.0-beta.1',
    cwd: '/project',
    terminal: {
      write: (msg: string) => lines.push(msg),
      writeLine: (msg: string) => lines.push(msg),
      writeError: (msg: string) => lines.push(msg),
    },
    _lines: lines,
    ...overrides,
  } as unknown as IPreflightContext & { _lines: string[] };
}

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue('');
  // Clear known API key env vars
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];
  delete process.env['DEEPSEEK_API_KEY'];
  delete process.env['DASHSCOPE_API_KEY'];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runDiagnoseCommand', () => {
  it('reports API key found for ANTHROPIC_API_KEY', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/API key.*ok|✓.*API key/i);
  });

  it('reports API key found for DASHSCOPE_API_KEY (PM-035 regression)', async () => {
    process.env['DASHSCOPE_API_KEY'] = 'ds-test-key';
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/Qwen|DashScope/);
  });

  it('reports no API key when none set', async () => {
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/No API key found/);
  });

  it('reports settings file OK when project settings exist', async () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith('settings.json'));
    mockedReadFileSync.mockReturnValue('{"currentProvider":"anthropic"}');
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/Settings file.*ok|✓.*Settings/i);
  });

  it('reports settings file fail when JSON is corrupt', async () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith('settings.json'));
    mockedReadFileSync.mockReturnValue('{not valid json}');
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/invalid JSON/i);
  });

  it('reports settings file warn when not found', async () => {
    mockedExistsSync.mockReturnValue(false);
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/Not found/);
  });

  it('includes Node.js version in output', async () => {
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    expect(output).toMatch(/Node\.js version/);
  });

  it('uses correct configure flag in error messages (PM-035 regression)', async () => {
    const ctx = makeCtx();
    await runDiagnoseCommand(ctx);
    const output = (ctx as unknown as { _lines: string[] })._lines.join('\n');
    // Must say "--configure" not "configure" alone
    expect(output).not.toMatch(/robota configure(?! -)/);
  });
});
