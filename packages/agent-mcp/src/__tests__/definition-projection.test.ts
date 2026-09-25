/**
 * TC-03b — redacted management projections.
 *
 * The projection is what leaves this package. A value that survives it survives into a log, a
 * screen, or a command result, so the assertions here are about what must NOT be there — and about
 * the keys that must remain, because `Authorization: [REDACTED]` and "no Authorization header" are
 * different answers to the operator's question.
 */

import { describe, expect, it } from 'vitest';

import { applyDisableOverlay } from '../definition/overlay.js';
import { projectEntries, projectEntry, REDACTED } from '../definition/projection.js';

import type { IMCPResolvedEntry } from '../definition/types.js';

const remote: IMCPResolvedEntry = {
  name: 'alpha',
  source: 'managed',
  origin: 'policy.json',
  status: 'resolved',
  definition: {
    name: 'alpha',
    source: 'managed',
    origin: 'policy.json',
    transport: 'http',
    url: 'https://api.example/mcp',
    headers: { Authorization: 'Bearer super-secret', 'X-Tenant': 'acme' },
    env: { API_KEY: 'sk-live-1234567890' },
    timeout: 5000,
    unsetVariables: [{ variable: 'MISSING', field: 'url', literal: '${MISSING}' }],
  },
  shadowed: [{ name: 'alpha', source: 'user', origin: 'user.json' }],
};

describe('projectEntry', () => {
  it('projects stdio command, arguments and cwd readable, with the credential masked', () => {
    const projection = projectEntry({
      name: 'stdio',
      source: 'project',
      origin: 'fixture',
      status: 'resolved',
      shadowed: [],
      definition: {
        name: 'stdio',
        source: 'project',
        origin: 'fixture',
        transport: 'stdio',
        command: '/secret/bin',
        args: ['--token', 'secret-value'],
        cwd: '/secret/work',
        unsetVariables: [],
      },
    });
    expect(projection.command).toBe('/secret/bin');
    expect(projection.args).toEqual(['--token', 'secret:literal']);
    expect(projection.cwd).toBe('/secret/work');
    expect(JSON.stringify(projection)).not.toContain('secret-value');
  });
  it('redacts every env and header value while keeping their keys', () => {
    const projection = projectEntry(remote);

    expect(projection.headers).toEqual({ Authorization: REDACTED, 'X-Tenant': REDACTED });
    expect(projection.env).toEqual({ API_KEY: REDACTED });

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('sk-live-1234567890');
    expect(serialized).toContain('Authorization');
    expect(serialized).toContain('API_KEY');
  });

  it('keeps the url readable, because it is the address the operator identifies the server by', () => {
    expect(projectEntry(remote).url).toBe('https://api.example/mcp');
  });

  it('reports unset variables by name and carries provenance and shadows', () => {
    const projection = projectEntry(remote);
    expect(projection.unsetVariables).toEqual(['MISSING']);
    expect(projection.source).toBe('managed');
    expect(projection.origin).toBe('policy.json');
    expect(projection.shadowed).toEqual([{ source: 'user', origin: 'user.json' }]);
  });

  it('projects an unresolved entry with its reason and no definition fields', () => {
    const projection = projectEntry({
      name: 'beta',
      source: 'managed',
      origin: 'policy.json',
      status: 'unresolved',
      problem: { name: 'beta', source: 'managed', origin: 'policy.json', reason: 'no `type`' },
      shadowed: [{ name: 'beta', source: 'plugin', origin: 'plugin-a' }],
    });

    expect(projection.status).toBe('unresolved');
    expect(projection.problem).toBe('no `type`');
    expect(projection.transport).toBeUndefined();
    expect(projection.url).toBeUndefined();
    expect(projection.shadowed).toHaveLength(1);
  });

  it('reports the disabled state and its reason', () => {
    const [disabled] = applyDisableOverlay([remote], { disabled: { alpha: 'paused by operator' } });
    const projection = projectEntry(disabled!);
    expect(projection.disabled).toBe(true);
    expect(projection.disabledReason).toBe('paused by operator');
    expect(projectEntry(remote).disabled).toBe(false);
  });

  it('projects a whole set in order', () => {
    expect(projectEntries([remote]).map((entry) => entry.name)).toEqual(['alpha']);
  });
});
