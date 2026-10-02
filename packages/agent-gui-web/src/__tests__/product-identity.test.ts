import { describe, expect, it } from 'vitest';
import { resolvePageProductIdentity } from '../product-identity.js';
const identity = (name: string) => ({ identity: { displayName: name, cliName: name }, storage: { browserNamespace: `${name}.browser` } });
const page = (value?: unknown) => ({ getElementById: () => value === undefined ? null : ({ textContent: JSON.stringify(value) } as HTMLElement) });

describe('host public identity', () => {
  it('keeps sequential and concurrent host products independent of the selected build', async () => {
    const a = identity('cedar');
    const b = identity('birch');
    expect(resolvePageProductIdentity(page(a), b)).toEqual(a);
    expect(resolvePageProductIdentity(page(b), a)).toEqual(b);
    expect(resolvePageProductIdentity(page(a), b)).toEqual(a);
    expect(await Promise.all([a, b].map(async (value) => resolvePageProductIdentity(page(value), a)))).toEqual([a, b]);
    expect(resolvePageProductIdentity(page(), b)).toBe(b);
  });
  it('refuses an incomplete host identity instead of using the build product', () => {
    expect(() => resolvePageProductIdentity(page({ identity: { displayName: 'cedar' } }), identity('birch'))).toThrow(/missing required/);
  });
  it('projects only fields used by the GUI', () => {
    const a = identity('cedar');
    expect(resolvePageProductIdentity(page({ ...a, ignored: 'not-a-public-field' }), identity('birch'))).toEqual(a);
  });
});
