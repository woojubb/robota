import type { InteractionEvent } from '../index.js';
import { expect, it } from 'vitest';

const legacySettlement: InteractionEvent = {
  // @ts-expect-error ARCH-017: settlement is `prompt_resolved`, not a display-event variant.
  type: 'permission-resolved',
  id: 'legacy',
  granted: true,
};

void legacySettlement;

it('keeps the obsolete prompt settlement display event rejected by the public type contract', () => {
  expect(Object.keys(legacySettlement)).toContain('type');
});
