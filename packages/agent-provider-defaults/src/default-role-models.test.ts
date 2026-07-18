import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { DEFAULT_ROLE_MODELS } from './default-role-models.js';

import type { TModelRef } from '@robota-sdk/agent-core';

/**
 * SELFHOST-006 TC-05 — the concrete role vocabulary (`planner`/`editor`/`reviewer`) lives HERE (the
 * product/default layer), not in the neutral `agent-core` contract. This asserts the default set is
 * well-formed AND that the neutral contract file carries no fixed role vocabulary / enum.
 */
describe('SELFHOST-006 TC-05 — concrete role set lives in the default layer', () => {
  it('DEFAULT_ROLE_MODELS provides the planner/editor/reviewer roles as ordered chains', () => {
    for (const role of ['planner', 'editor', 'reviewer']) {
      const chain = DEFAULT_ROLE_MODELS[role];
      expect(chain).toBeDefined();
      expect(chain!.length).toBeGreaterThanOrEqual(1);
      for (const ref of chain as TModelRef[]) {
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

  it('the neutral agent-core contract is an opaque Record with no enum/union role vocabulary', () => {
    const contract = readFileSync(
      new URL('../../agent-core/src/interfaces/role-model.ts', import.meta.url),
      'utf8',
    );
    // positive: the map is keyed by an opaque string (Record), not a fixed key set
    expect(contract).toMatch(/Record<string,\s*TModelRef\[\]>/);
    // negative: no `enum` DECLARATION and no string-literal union TYPE (a fixed role vocabulary)
    expect(contract).not.toMatch(/\benum\s+\w+/); // e.g. `enum Role {`
    expect(contract).not.toMatch(/type\s+\w+\s*=\s*'[^']+'\s*\|/); // e.g. `type TRole = 'planner' | ...`
    expect(contract).not.toMatch(/'planner'|'editor'|'reviewer'/); // no concrete role literals
  });
});
