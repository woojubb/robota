import { expect, it } from 'vitest';
import { OrganizationNoEffect } from '../no-effect.js';
import { fixture } from './fixtures.js';

it('records a trusted pre-dispatch budget refusal without retaining a nonexistent effect', async () => {
  const f = fixture();
  try {
    const broker = f.broker([{ resource: 'asset', operation: 'read', roles: ['operator'], requiresApproval: false,
      reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
      execute: async () => { throw new OrganizationNoEffect('budget-exhausted', { tokens: 0, timeMs: 0, costMicros: 0 }); },
    }]);
    await expect(broker.apply(f.call(f.request()))).rejects.toThrow(/budget-exhausted/u);
    expect(f.ledger.budgetState('grant', f.grant.id).held.tokens).toBe(0);
    expect(f.ledger.budgetState('grant', f.grant.id).spent.tokens).toBe(0);
  } finally { f.cleanup(); }
});
