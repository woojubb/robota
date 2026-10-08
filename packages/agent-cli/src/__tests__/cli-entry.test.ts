import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestProductRuntime } from './helpers/product-runtime.js';

const start = vi.hoisted(() => vi.fn(async () => undefined));
const diagnostics = vi.hoisted(() => vi.fn());
vi.mock('../cli.js', () => ({ startCli: start }));
vi.mock('../bootstrap-diagnostics.js', () => ({ installCliDiagnostics: diagnostics }));

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

  it('formats the interactive crash hint with the configured CLI name', () => {
    expect(formatCliImeHint('amber')).toContain('[amber] CJK/IME input error');
  });
});
