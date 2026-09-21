/**
 * TC-10 — activation identity and fingerprint.
 *
 * MCP-2520 invalidates an approval when either value changes, so these assertions are about what
 * SHOULD invalidate (anything that changes what runs or where it came from) and what should not
 * (rotating a secret's value — the operator approved the server, not the credential).
 */

import { describe, expect, it } from 'vitest';

import { activationIdentity, definitionFingerprint, securityIdentity } from '../definition/identity.js';

import type { IMCPResolvedEntry, IMCPServerDefinitionResolved } from '../definition/types.js';

const definition = (
  overrides: Partial<IMCPServerDefinitionResolved> = {},
): IMCPServerDefinitionResolved => ({
  name: 'alpha',
  source: 'project',
  origin: '.mcp.json',
  transport: 'stdio',
  command: 'server',
  args: ['--port', '1'],
  env: { API_KEY: 'sk-1' },
  unsetVariables: [],
  ...overrides,
});

const entry = (overrides: Partial<IMCPResolvedEntry> = {}): IMCPResolvedEntry => ({
  name: 'alpha',
  source: 'project',
  origin: '.mcp.json',
  status: 'resolved',
  definition: definition(),
  shadowed: [],
  ...overrides,
});

describe('definitionFingerprint', () => {
  it('is stable across re-resolution of an unchanged definition', () => {
    expect(definitionFingerprint(definition())).toBe(definitionFingerprint(definition()));
  });

  it('changes when anything that decides what runs changes', () => {
    const base = definitionFingerprint(definition());
    expect(definitionFingerprint(definition({ command: 'other' }))).not.toBe(base);
    expect(definitionFingerprint(definition({ args: ['--port', '2'] }))).not.toBe(base);
    expect(definitionFingerprint(definition({ timeout: 1000 }))).not.toBe(base);
    expect(
      definitionFingerprint(
        definition({ transport: 'http', command: undefined, args: undefined, url: 'https://a' }),
      ),
    ).not.toBe(base);
  });

  it('changes when an env or header KEY changes', () => {
    const base = definitionFingerprint(definition());
    expect(definitionFingerprint(definition({ env: { OTHER_KEY: 'sk-1' } }))).not.toBe(base);
    expect(
      definitionFingerprint(definition({ headers: { Authorization: 'x' }, env: { API_KEY: 'sk-1' } })),
    ).not.toBe(base);
  });

  it('does NOT change when only a secret VALUE changes', () => {
    // A fingerprint travels into audit records and approval stores. Hashing the secret would put a
    // value derived from it there, and rotating a token would read as a new server.
    expect(definitionFingerprint(definition({ env: { API_KEY: 'sk-2' } }))).toBe(
      definitionFingerprint(definition()),
    );
  });

  it('does not collide when field boundaries shift', () => {
    expect(definitionFingerprint(definition({ command: 'ab', args: ['c'] }))).not.toBe(
      definitionFingerprint(definition({ command: 'a', args: ['bc'] })),
    );
  });
});

describe('securityIdentity', () => {
  it('differs for the same server name from different scopes', () => {
    const fromProject = securityIdentity(entry());
    const fromPlugin = securityIdentity(entry({ source: 'plugin', origin: 'plugin-a' }));
    expect(fromProject).not.toBe(fromPlugin);
  });

  it('is stable for the same name, source and origin', () => {
    expect(securityIdentity(entry())).toBe(securityIdentity(entry()));
  });
});

describe('activationIdentity', () => {
  it('produces the ids an activation request carries', () => {
    const identity = activationIdentity(entry());
    expect(identity).toEqual({
      serverId: 'alpha',
      definitionFingerprint: definitionFingerprint(definition()),
      securityIdentity: securityIdentity(entry()),
    });
  });

  it('returns null for an unresolved entry rather than inventing an identity', () => {
    expect(activationIdentity(entry({ status: 'unresolved', definition: undefined }))).toBeNull();
  });
});
