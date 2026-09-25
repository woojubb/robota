/**
 * The `oauth` block of a remote definition: typed, strictly decoded, never carrying a secret, and
 * part of what an approval covers.
 */

import { describe, expect, it } from 'vitest';

import { decodeEntry } from '../definition/decode.js';
import { materializeDefinition } from '../definition/env-template.js';
import { definitionFingerprint } from '../definition/identity.js';

import type { IMCPServerDefinition } from '../definition/types.js';

function decode(oauth: unknown, extra: Record<string, unknown> = {}) {
  return decodeEntry({
    name: 'files',
    source: 'user',
    origin: '~/.robota/settings.json',
    entry: { type: 'http', url: 'https://mcp.example.test/mcp', oauth, ...extra },
  });
}

function reasonOf(result: ReturnType<typeof decode>): string {
  if (!('reason' in result)) throw new Error('expected a refusal');
  return result.reason;
}

describe('oauth definition', () => {
  it('decodes every field into a typed block', () => {
    const decoded = decode({
      clientId: 'robota-cli',
      callbackPort: 8765,
      authServerMetadataUrl: 'https://auth.example.test/',
      scopes: ['files:read', 'files:write'],
    });
    if ('reason' in decoded) throw new Error(decoded.reason);
    expect(decoded.oauth).toEqual({
      clientId: 'robota-cli',
      callbackPort: 8765,
      authServerMetadataUrl: 'https://auth.example.test/',
      scopes: ['files:read', 'files:write'],
    });
    expect(decode({})).toMatchObject({ oauth: {} });
  });

  it('requires callbackPort beside a pre-registered clientId', () => {
    expect(reasonOf(decode({ clientId: 'robota-cli' }))).toContain('callbackPort');
  });

  it('requires an https metadata URL', () => {
    expect(reasonOf(decode({ authServerMetadataUrl: 'http://auth.example.test/' }))).toContain(
      'https',
    );
    expect(reasonOf(decode({ authServerMetadataUrl: 'not a url' }))).toContain('https');
  });

  it('never accepts a client secret, and names where one goes instead', () => {
    const reason = reasonOf(
      decode({ clientId: 'a', callbackPort: 1, clientSecret: 'shh-secret-value' }),
    );
    expect(reason).toContain('--client-secret');
    expect(reason).not.toContain('shh-secret-value');
  });

  it('refuses unknown keys, bad ports, bad scopes, templates and a non-object', () => {
    expect(reasonOf(decode({ tokenUrl: 'x' }))).toContain('accepts only');
    expect(reasonOf(decode({ callbackPort: 0 }))).toContain('callbackPort');
    expect(reasonOf(decode({ callbackPort: 70_000 }))).toContain('callbackPort');
    expect(reasonOf(decode({ scopes: 'files:read' }))).toContain('scopes');
    expect(reasonOf(decode({ scopes: ['two words'] }))).toContain('scopes');
    expect(reasonOf(decode({ scopes: [] }))).toContain('scopes');
    expect(reasonOf(decode({ clientId: '${CLIENT}', callbackPort: 1 }))).toContain('templates');
    expect(reasonOf(decode('yes'))).toContain('object');
  });

  it('refuses oauth beside a header helper, and on a stdio server', () => {
    expect(reasonOf(decode({}, { headersHelper: { command: '/bin/helper' } }))).toContain('both');
    const stdio = decodeEntry({
      name: 'files',
      source: 'user',
      origin: 'settings',
      entry: { type: 'stdio', command: 'server', oauth: {} },
    });
    expect(reasonOf(stdio)).toContain('oauth');
  });

  it('is covered by the definition fingerprint', () => {
    const fingerprint = (oauth: unknown): string => {
      const decoded = decode(oauth);
      if ('reason' in decoded) throw new Error(decoded.reason);
      return definitionFingerprint(materializeDefinition(decoded as IMCPServerDefinition, {}));
    };
    const none = decodeEntry({
      name: 'files',
      source: 'user',
      origin: '~/.robota/settings.json',
      entry: { type: 'http', url: 'https://mcp.example.test/mcp' },
    }) as IMCPServerDefinition;
    const base = fingerprint({});
    expect(base).not.toBe(definitionFingerprint(materializeDefinition(none, {})));
    expect(fingerprint({ scopes: ['a'] })).not.toBe(base);
    expect(fingerprint({ authServerMetadataUrl: 'https://other.example.test/' })).not.toBe(base);
  });
});
