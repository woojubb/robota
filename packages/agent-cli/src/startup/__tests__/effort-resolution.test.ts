import { describe, expect, it, vi } from 'vitest';

import { createCliEffortAdapter, resolveCliModelEffort } from '../effort-resolution.js';

/** The running product's own alias prefix: the name an error must give, not the canonical one. */
const ENV_PREFIX = 'CEDAR_';

describe('resolveCliModelEffort', () => {
  it('keeps flag above every lower-priority source', () => {
    expect(
      resolveCliModelEffort(
        { effort: 'low' },
        { PRODUCT_EFFORT: 'medium' },
        ENV_PREFIX,
        { effort: 'high' },
        { effort: 'xhigh' },
      ),
    ).toMatchObject({ effective: 'low', source: 'flag' });
  });

  it('reads the environment and settings boundaries as untrusted values', () => {
    expect(
      resolveCliModelEffort(
        { effort: undefined },
        { PRODUCT_EFFORT: 'medium' },
        ENV_PREFIX,
        {},
        {},
      ),
    ).toMatchObject({ effective: 'medium', source: 'environment' });
  });

  it('names the effort variable the running product accepts, not the canonical one', () => {
    const refuse = (envPrefix: string): string => {
      try {
        resolveCliModelEffort(
          { effort: undefined },
          { PRODUCT_EFFORT: 'turbo' },
          envPrefix,
          {},
          {},
        );
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected the effort value to be refused');
    };
    expect(refuse(ENV_PREFIX)).toMatch(/^Invalid CEDAR_EFFORT "turbo"/u);
    expect(refuse(ENV_PREFIX)).not.toContain('PRODUCT_EFFORT');
    expect(refuse('ROBOTA_')).toMatch(/^Invalid ROBOTA_EFFORT "turbo"/u);
  });

  it('keeps a live auto command as the provider-boundary selection', async () => {
    const adapter = createCliEffortAdapter(
      resolveCliModelEffort({ effort: undefined }, {}, ENV_PREFIX, {}, {}),
    );
    const applyModelOptions = vi.fn().mockResolvedValue(undefined);

    await adapter.apply('auto', { applyModelOptions } as never);

    expect(applyModelOptions).toHaveBeenCalledWith({ effort: 'auto' });
  });
});
