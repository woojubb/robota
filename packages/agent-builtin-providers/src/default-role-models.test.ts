import { describe, it, expect } from 'vitest';

import { DEFAULT_ROLE_MODELS } from './default-role-models.js';

import type { IModelRef } from '@robota-sdk/agent-core';

/**
 * SELFHOST-006 TC-05 — the concrete role vocabulary (`planner`/`editor`/`reviewer`) lives HERE (the
 * product/default layer), not in the neutral `agent-core` contract. This asserts the default set is
 * well-formed. The neutral contract's vocabulary is verified by agent-core's owner-local tests.
 */
describe('SELFHOST-006 TC-05 — concrete role set lives in the default layer', () => {
  it('DEFAULT_ROLE_MODELS provides the planner/editor/reviewer roles as ordered chains', () => {
    for (const role of ['planner', 'editor', 'reviewer']) {
      const chain = DEFAULT_ROLE_MODELS[role];
      expect(chain).toBeDefined();
      expect(chain!.length).toBeGreaterThanOrEqual(1);
      for (const ref of chain as IModelRef[]) {
        expect(typeof ref.provider).toBe('string');
        expect(typeof ref.model).toBe('string');
      }
    }
  });

  it('each role carries a cross-provider fallback (an alternate provider AND model)', () => {
    const planner = DEFAULT_ROLE_MODELS['planner']!;
    expect(planner.length).toBeGreaterThanOrEqual(2);
    expect(planner[0]!.provider).not.toBe(planner[1]!.provider);
  });
});
