import { expect, it } from 'vitest';

import { ensureProviderConfig } from '../provider-startup.js';

it('requires host settings access before provider startup', async () => {
  await expect(
    ensureProviderConfig(
      process.cwd(),
      {} as never,
      async () => '',
      { writeLine: () => undefined, writeError: () => undefined } as never,
      [],
      { formatError: () => 'Provider is not configured.' },
    ),
  ).rejects.toThrow('Provider startup requires host settings sources and stores.');
});
