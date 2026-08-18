import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';
import type { ITuiInteractionChannelOptions } from '../TuiInteractionChannel.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * #1844 — the provider definitions must survive the whole mapping chain.
 *
 * `providerDefinitions` was declared on the session options and read by `/provider switch`, and no
 * production code set it. The consequence is not a dormant field: with an empty list the hot-swap
 * throws `Unknown provider: <name>. Currently supported: ` — an empty supported-list, which is both
 * wrong and unactionable. Measured, not inferred.
 *
 * Each hop is asserted separately because a forward that stops at any one of them restores exactly
 * the bug, and an end-to-end assertion alone would not say WHERE it stopped.
 */
const DEFINITIONS = [
  { type: 'anthropic', displayName: 'Anthropic' },
] as unknown as readonly IProviderDefinition[];

const renderOptions = (over: Partial<IRenderOptions> = {}): IRenderOptions =>
  ({ cwd: '/w', provider: {}, ...over }) as IRenderOptions;

describe('#1844 — provider definitions reach the session', () => {
  it('render options carry them into the channel options', () => {
    const channel = toChannelOptions(renderOptions({ providerDefinitions: DEFINITIONS }));

    expect(channel.providerDefinitions).toBe(DEFINITIONS);
  });

  it('channel options carry them into the session options', () => {
    const session = buildTuiSessionOptions({
      cwd: '/w',
      provider: {},
      providerDefinitions: DEFINITIONS,
    } as unknown as ITuiInteractionChannelOptions);

    expect(session).toHaveProperty('providerDefinitions', DEFINITIONS);
  });

  it('the whole chain preserves them', () => {
    const session = buildTuiSessionOptions(
      toChannelOptions(
        renderOptions({ providerDefinitions: DEFINITIONS }),
      ) as unknown as ITuiInteractionChannelOptions,
    );

    expect(session).toHaveProperty('providerDefinitions', DEFINITIONS);
  });

  it('omits the key entirely when none were supplied, rather than setting an empty list', () => {
    // An explicit `[]` would look like "the caller supplied none" and read as configured. Absent is
    // the honest shape for "this surface did not provide them", and it also keeps
    // `exactOptionalPropertyTypes` callers from having to pass undefined.
    const session = buildTuiSessionOptions({
      cwd: '/w',
      provider: {},
    } as unknown as ITuiInteractionChannelOptions);

    expect('providerDefinitions' in session).toBe(false);
  });
});
