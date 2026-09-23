import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

describe('SELFHOST-006 TC-05 — neutral role-model contract', () => {
  it('the neutral agent-core contract is an opaque Record with no enum/union role vocabulary', () => {
    const contract = readFileSync(new URL('../interfaces/role-model.ts', import.meta.url), 'utf8');
    // positive: the map is keyed by an opaque string (Record), not a fixed key set
    expect(contract).toMatch(/Record<string,\s*IModelRef\[\]>/);
    // negative: no `enum` DECLARATION and no string-literal union TYPE (a fixed role vocabulary)
    expect(contract).not.toMatch(/\benum\s+\w+/); // e.g. `enum Role {`
    expect(contract).not.toMatch(/type\s+\w+\s*=\s*'[^']+'\s*\|/); // e.g. `type TRole = 'planner' | ...`
    expect(contract).not.toMatch(/'planner'|'editor'|'reviewer'/); // no concrete role literals
  });
});
