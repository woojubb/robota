/**
 * The headless executable applies same-user inspection hardening before anything else of its own
 * runs, as the CLI entry does (`cli-entry-hardening.test.ts`, which also says why each entry has its
 * own file).
 */

import { describe, expect, it, vi } from 'vitest';

const { hardenProduct, resolveCliRuntimeContext } = vi.hoisted(() => ({
  hardenProduct: vi.fn(),
  resolveCliRuntimeContext: vi.fn(() => {
    throw new Error('stop after the first step');
  }),
}));

// The real call would change the test worker's own process.
vi.mock('../process-hardening.js', () => ({ hardenProductProcess: hardenProduct }));
vi.mock('../startup/product-bootstrap.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../startup/product-bootstrap.js')>()),
  resolveCliRuntimeContext,
}));

describe('the headless executable', () => {
  it('hardens its process before it resolves its runtime', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitCode = process.exitCode;
    try {
      await import('../headless-bin.js');
    } finally {
      process.exitCode = exitCode;
      stderr.mockRestore();
    }

    expect(hardenProduct).toHaveBeenCalledTimes(1);
    expect(resolveCliRuntimeContext).toHaveBeenCalledTimes(1);
    expect(hardenProduct.mock.invocationCallOrder[0]).toBeLessThan(
      resolveCliRuntimeContext.mock.invocationCallOrder[0] ?? 0,
    );
  }, 30_000);
});
