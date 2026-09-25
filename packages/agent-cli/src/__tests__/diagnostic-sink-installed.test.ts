import { setGlobalLoggerSink } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * CORE-029 / NEUT-010 — the runtime's diagnostics reach a user in this product.
 *
 * Review of #1595 made the point that mattered: `agent-core` defaults to a silent sink and nothing
 * in the repository installed one, so adding a WARNING for an unregistered model changed nothing an
 * operator could observe. A guard nobody can hear is the same defect as no guard.
 *
 * This asserts the wiring exists at the entry point, and that a diagnostic emitted by the runtime
 * actually arrives — not merely that a function was called.
 */
describe('the CLI installs a destination for runtime diagnostics', () => {
  afterEach(() => {
    setGlobalLoggerSink(undefined);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('installs a sink when the binary is loaded', async () => {
    // Read core from the SAME module generation the binary registers into. A statically imported
    // `getGlobalLoggerSink` belongs to a different instance after `resetModules`, and asking it
    // would answer about a registry nobody wrote to.
    vi.resetModules();
    const before = await import('@robota-sdk/agent-core');
    expect(before.getGlobalLoggerSink()).toBeUndefined();

    vi.resetModules();
    // `bin.ts` registers process handlers and calls startCli(); stub the latter so importing it is
    // safe here. The sink installation is a module-level statement and runs regardless.
    vi.doMock('../cli.js', () => ({ startCli: () => Promise.resolve() }));
    await import('../bin.js');
    const after = await import('@robota-sdk/agent-core');

    expect(after.getGlobalLoggerSink()).toBeDefined();
  });

  it('routes a runtime warning to console.error, which Ink prints above its frame', async () => {
    const written: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    });

    vi.resetModules();
    vi.doMock('../cli.js', () => ({ startCli: () => Promise.resolve() }));
    await import('../bin.js');
    const core = await import('@robota-sdk/agent-core');

    // The exact diagnostic NEUT-010 added: a model nobody registered.
    core.getModelContextWindow('some-other-vendor/model-x');

    expect(written.some((line) => line.includes('some-other-vendor/model-x'))).toBe(true);
    expect(written.some((line) => line.includes('[robota]'))).toBe(true);
  });

  it("prints a warning's structured context instead of [object Object]", async () => {
    const written: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    });

    vi.resetModules();
    vi.doMock('../cli.js', () => ({ startCli: () => Promise.resolve() }));
    await import('../bin.js');
    const core = await import('@robota-sdk/agent-core');

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    core.createLogger('probe').warn('plugin skipped', {
      plugin: 'demo@market',
      attempts: 2,
      error: new Error('manifest unreadable'),
      circular,
    } as never);

    const line = written.find((text) => text.includes('plugin skipped')) ?? '';
    expect(line).toContain('plugin=demo@market');
    expect(line).toContain('attempts=2');
    expect(line).toContain('error=Error: manifest unreadable');
    // A circular value has no JSON form; printing it must not throw out of the logger.
    expect(line).toContain('circular=');
  });

  it('stays quiet below the warn level, so ordinary output is not buried', async () => {
    const written: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    });

    vi.resetModules();
    vi.doMock('../cli.js', () => ({ startCli: () => Promise.resolve() }));
    await import('../bin.js');
    const core = await import('@robota-sdk/agent-core');

    core.createLogger('probe').debug('a debug line');
    core.createLogger('probe').info('an info line');

    expect(written.some((line) => line.includes('a debug line'))).toBe(false);
    expect(written.some((line) => line.includes('an info line'))).toBe(false);
  });
});
