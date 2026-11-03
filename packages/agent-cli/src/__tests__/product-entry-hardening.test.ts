/**
 * Same-user inspection hardening is a policy of the product's own executables: each entry a product
 * process starts from — the shipped source/bundle entry (also the one the compiled binary embeds)
 * and the headless executable — applies it before anything else of its own runs. The CommonJS
 * wrapper is covered by real processes in `inspector-signal-hardening.test.ts` and, on Linux,
 * `process-hardening-kernel.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const hardenProduct = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../process-hardening.js');
  vi.doUnmock('../cli-entry.js');
  vi.doUnmock('../startup/product-bootstrap.js');
  hardenProduct.mockReset();
});

describe('product entries harden their own process', () => {
  it('the CLI entry hardens before it starts the complete CLI entry', async () => {
    const startCliEntry = vi.fn(async () => undefined);
    vi.resetModules();
    // The real call would change the test worker's own process.
    vi.doMock('../process-hardening.js', () => ({ hardenProductProcess: hardenProduct }));
    vi.doMock('../cli-entry.js', () => ({ startCliEntry }));

    await import('../bin.js');

    expect(hardenProduct).toHaveBeenCalledTimes(1);
    expect(startCliEntry).toHaveBeenCalledTimes(1);
    expect(hardenProduct.mock.invocationCallOrder[0]).toBeLessThan(
      startCliEntry.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('the headless executable hardens before it resolves its runtime', async () => {
    const resolveCliRuntimeContext = vi.fn(() => {
      throw new Error('stop after the first step');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitCode = process.exitCode;
    vi.resetModules();
    vi.doMock('../process-hardening.js', () => ({ hardenProductProcess: hardenProduct }));
    vi.doMock('../startup/product-bootstrap.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../startup/product-bootstrap.js')>()),
      resolveCliRuntimeContext,
    }));

    try {
      await import('../headless-bin.js');
    } finally {
      process.exitCode = exitCode;
    }

    expect(hardenProduct).toHaveBeenCalledTimes(1);
    expect(resolveCliRuntimeContext).toHaveBeenCalledTimes(1);
    expect(hardenProduct.mock.invocationCallOrder[0]).toBeLessThan(
      resolveCliRuntimeContext.mock.invocationCallOrder[0] ?? 0,
    );
  }, 30_000);
});
