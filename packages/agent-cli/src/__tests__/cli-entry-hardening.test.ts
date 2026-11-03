/**
 * Same-user inspection hardening is a policy of the product's own executables: each entry a product
 * process starts from applies it before anything else of its own runs. This file covers the shipped
 * source/bundle entry (also the one the compiled binary embeds); `headless-entry-hardening.test.ts`
 * covers the headless executable. The CommonJS wrapper is covered by real processes in
 * `inspector-signal-hardening.test.ts` and, on Linux, `process-hardening-kernel.test.ts`.
 *
 * One entry per file, mocked once and hoisted: re-mocking between tests of one file let the second
 * entry's import run against a module graph the first test had already loaded, about one run in six.
 */

import { describe, expect, it, vi } from 'vitest';

const { hardenProduct, startCliEntry } = vi.hoisted(() => ({
  hardenProduct: vi.fn(),
  startCliEntry: vi.fn(async () => undefined),
}));

// The real call would change the test worker's own process.
vi.mock('../process-hardening.js', () => ({ hardenProductProcess: hardenProduct }));
vi.mock('../cli-entry.js', () => ({ startCliEntry }));

describe('the CLI entry', () => {
  it('hardens its process before it starts the complete CLI entry', async () => {
    await import('../bin.js');

    expect(hardenProduct).toHaveBeenCalledTimes(1);
    expect(startCliEntry).toHaveBeenCalledTimes(1);
    expect(hardenProduct.mock.invocationCallOrder[0]).toBeLessThan(
      startCliEntry.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
