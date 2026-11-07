import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestProductRuntime } from './helpers/product-runtime.js';

const start = vi.hoisted(() => vi.fn(async () => undefined));
const diagnostics = vi.hoisted(() => vi.fn());
const harden = vi.hoisted(() => vi.fn(() => true));
const hardenProduct = vi.hoisted(() => vi.fn());
vi.mock('../cli.js', () => ({ startCli: start }));
vi.mock('../bootstrap-diagnostics.js', () => ({ installCliDiagnostics: diagnostics }));
// The real calls would change the test worker's own process.
vi.mock('../process-hardening.js', () => ({
  hardenProcessAgainstSameUserInspection: harden,
  hardenProductProcess: hardenProduct,
}));

import { startCliEntry } from '../cli-entry.js';
import { formatCliImeHint } from '../cli-crash-policy.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('public complete CLI entry', () => {
  it('installs configured diagnostics and forwards the complete host options to existing dispatch', async () => {
    const productRuntime = createTestProductRuntime('cedar');
    const options = { productRuntime, commandModules: [] };
    await startCliEntry(options);
    expect(diagnostics).toHaveBeenCalledWith('cedar');
    expect(start).toHaveBeenCalledWith(options);
  });

  it('leaves the host process as it is: hardening belongs to the product executables', async () => {
    // A host that embeds this entry in-process decides for its own process; an undumpable host or one
    // whose SIGUSR1 no longer opens an inspector is a side effect it never asked for.
    const productRuntime = createTestProductRuntime('cedar');

    await startCliEntry({ productRuntime, commandModules: [] });

    expect(start).toHaveBeenCalledTimes(1);
    expect(hardenProduct).not.toHaveBeenCalled();
    expect(harden).not.toHaveBeenCalled();
  });

  it('formats the interactive crash hint with the configured CLI name', () => {
    expect(formatCliImeHint('amber')).toContain('[amber] CJK/IME input error');
  });
});
