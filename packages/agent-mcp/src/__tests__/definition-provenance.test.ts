/**
 * Value provenance: one principle decides what is secret, and both the fingerprint and every place
 * that prints a materialized value read it.
 *
 * A value is secret because of what it is — it came from a credential-shaped variable, or it sits
 * under a credential-shaped key — not because of which field carries it.
 */

import { describe, expect, it } from 'vitest';

import { activationEndpoint, definitionFingerprint } from '../definition/identity.js';
import { materializeDefinition } from '../definition/env-template.js';
import { projectEntry } from '../definition/projection.js';
import { isCredentialShapedName } from '../definition/secrecy.js';

import type { IMCPServerDefinition } from '../definition/types.js';

const stdio = (overrides: Partial<IMCPServerDefinition> = {}): IMCPServerDefinition => ({
  name: 'alpha',
  source: 'project',
  origin: '.mcp.json',
  transport: 'stdio',
  command: 'server',
  ...overrides,
});

const http = (overrides: Partial<IMCPServerDefinition> = {}): IMCPServerDefinition => ({
  name: 'beta',
  source: 'project',
  origin: '.mcp.json',
  transport: 'http',
  url: 'https://mcp.example.com/api?key=${SERVICE_TOKEN}',
  ...overrides,
});

const fingerprint = (definition: IMCPServerDefinition, env: Record<string, string>): string =>
  definitionFingerprint(materializeDefinition(definition, env));

describe('the fingerprint follows value provenance', () => {
  it('changes when an execution-controlling env value changes, on any transport', () => {
    const withOptions = (value: string): IMCPServerDefinition =>
      http({ env: { NODE_OPTIONS: value } });
    expect(fingerprint(withOptions('--max-old-space-size=100'), {})).not.toBe(
      fingerprint(withOptions('--require /tmp/evil.js'), {}),
    );
    expect(fingerprint(stdio({ env: { NODE_OPTIONS: 'a' } }), {})).not.toBe(
      fingerprint(stdio({ env: { NODE_OPTIONS: 'b' } }), {}),
    );
  });

  it('does not change when a credential rotates, wherever it is expanded', () => {
    expect(fingerprint(http(), { SERVICE_TOKEN: 'one' })).toBe(
      fingerprint(http(), { SERVICE_TOKEN: 'two' }),
    );
    const bearer = http({ headers: { Authorization: 'Bearer ${SERVICE_TOKEN}' } });
    expect(fingerprint(bearer, { SERVICE_TOKEN: 'one' })).toBe(
      fingerprint(bearer, { SERVICE_TOKEN: 'two' }),
    );
    const literal = (value: string): IMCPServerDefinition => stdio({ env: { API_KEY: value } });
    expect(fingerprint(literal('sk-1'), {})).toBe(fingerprint(literal('sk-2'), {}));
  });

  it('still changes when the host around a secret changes', () => {
    const at = (host: string): IMCPServerDefinition =>
      http({ url: `https://${host}/api?key=\${SERVICE_TOKEN}` });
    expect(fingerprint(at('mcp.example.com'), { SERVICE_TOKEN: 't' })).not.toBe(
      fingerprint(at('evil.example.com'), { SERVICE_TOKEN: 't' }),
    );
  });

  it('changes when a non-secret variable expands to something else', () => {
    const region = http({ url: 'https://${REGION}.example.com/mcp' });
    expect(fingerprint(region, { REGION: 'eu' })).not.toBe(fingerprint(region, { REGION: 'us' }));
  });
});

describe('printed endpoints never carry a secret', () => {
  it('replaces the secret spans of a URL and keeps the rest', () => {
    const endpoint = activationEndpoint(
      materializeDefinition(http(), { SERVICE_TOKEN: 'tok-live-123' }),
    );
    expect(endpoint).not.toContain('tok-live-123');
    expect(endpoint).toContain('https://mcp.example.com/api?key=');
  });

  it('replaces a secret expanded into a command line', () => {
    const endpoint = activationEndpoint(
      materializeDefinition(
        stdio({ args: ['--api-key', '${OPENAI_API_KEY}', '--port', '${PORT}'] }),
        {
          OPENAI_API_KEY: 'sk-live',
          PORT: '8080',
        },
      ),
    );
    expect(endpoint).not.toContain('sk-live');
    expect(endpoint).toContain('8080');
  });

  it('treats a default value of a credential-shaped variable as secret too', () => {
    const endpoint = activationEndpoint(
      materializeDefinition(
        http({ url: 'https://h.example.com/?t=${SERVICE_TOKEN:-dev-token}' }),
        {},
      ),
    );
    expect(endpoint).not.toContain('dev-token');
  });
});

describe('the projection', () => {
  it('keeps a URL readable while hiding the credential expanded into it', () => {
    const definition = materializeDefinition(http(), { SERVICE_TOKEN: 'tok-live-123' });
    const projection = projectEntry({
      name: 'beta',
      source: 'project',
      origin: '.mcp.json',
      status: 'resolved',
      definition,
      shadowed: [],
    });
    expect(projection.url).toBe('https://mcp.example.com/api?key=secret:SERVICE_TOKEN');
  });
});

describe('isCredentialShapedName', () => {
  it.each([
    'API_KEY',
    'GITHUB_TOKEN',
    'service-secret',
    'DB_PASSWORD',
    'Authorization',
    'Proxy-Authorization',
    'Cookie',
    'X-Api-Key',
    'GH_PAT',
    'DATABASE_URL',
    'SENTRY_DSN',
  ])('%s is credential-shaped', (name) => {
    expect(isCredentialShapedName(name)).toBe(true);
  });

  it.each(['KEYBOARD_LAYOUT', 'AUTHOR', 'NODE_OPTIONS', 'REGION', 'Content-Type', 'PATH'])(
    '%s is not',
    (name) => {
      expect(isCredentialShapedName(name)).toBe(false);
    },
  );
});
