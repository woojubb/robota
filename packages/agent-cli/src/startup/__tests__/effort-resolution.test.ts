import { describe, expect, it, vi } from 'vitest';

import { createCliEffortAdapter, resolveCliModelEffort } from '../effort-resolution.js';

describe('resolveCliModelEffort', () => {
  it('keeps flag above every lower-priority source', () => {
    expect(
      resolveCliModelEffort(
        { effort: 'low' },
        { ROBOTA_EFFORT: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
      ),
    ).toMatchObject({ effective: 'low', source: 'flag' });
  });

  it('reads the environment and settings boundaries as untrusted values', () => {
    expect(
      resolveCliModelEffort({ effort: undefined }, { ROBOTA_EFFORT: 'medium' }, {}, {}),
    ).toMatchObject({ effective: 'medium', source: 'environment' });
    expect(() =>
      resolveCliModelEffort({ effort: undefined }, { ROBOTA_EFFORT: 'turbo' }, {}, {}),
    ).toThrow('ROBOTA_EFFORT');
  });

  it('keeps a live auto command as the provider-boundary selection', async () => {
    const adapter = createCliEffortAdapter(
      resolveCliModelEffort({ effort: undefined }, {}, {}, {}),
    );
    const applyModelOptions = vi.fn().mockResolvedValue(undefined);

    await adapter.apply('auto', { applyModelOptions } as never);

    expect(applyModelOptions).toHaveBeenCalledWith({ effort: 'auto' });
  });
});
