/**
 * TC-07 — deprecated/unsupported transports are refusals, not silent absences (MCP-002).
 *
 * An SSE-only and a WebSocket server each appear in the `rejected` bucket with a reason. § Decision
 * ("rejected transports are refusals") and the criteria table both scope this to the `rejected`
 * bucket alone — `servers[]` is untouched for these, because `IMCPCatalogServerEntry.transport`
 * (`../catalog/types.ts`, not owned by this unit) is typed to exactly `'streamable-http' | 'stdio'`
 * and has no honest value for a transport that was never allowed to speak.
 */

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog/build.js';

describe('deprecated and unsupported transports are rejected, not silently absent', () => {
  it('an SSE-only server appears in rejected with a reason', () => {
    const catalog = buildCatalog([
      { serverId: 'legacy-sse', origin: 'test-fixture', transport: 'sse' },
    ]);

    const rejection = catalog.rejected.find((r) => r.serverId === 'legacy-sse');
    expect(rejection).toBeDefined();
    expect(rejection?.kind).toBe('server');
    expect(rejection?.reason).toMatch(/sse/i);
    expect(rejection?.reason.length).toBeGreaterThan(0);
  });

  it('a WebSocket server appears in rejected with a reason', () => {
    const catalog = buildCatalog([
      { serverId: 'custom-ws', origin: 'test-fixture', transport: 'ws' },
    ]);

    const rejection = catalog.rejected.find((r) => r.serverId === 'custom-ws');
    expect(rejection).toBeDefined();
    expect(rejection?.kind).toBe('server');
    expect(rejection?.reason).toMatch(/ws/i);
  });

  it('both are reported alongside a normally-accepted server, none silently dropped', () => {
    const catalog = buildCatalog([
      { serverId: 'legacy-sse', origin: 'test-fixture', transport: 'sse' },
      { serverId: 'custom-ws', origin: 'test-fixture', transport: 'ws' },
      { serverId: 'modern-http', origin: 'test-fixture', transport: 'streamable-http' },
    ]);

    expect(catalog.rejected.map((r) => r.serverId).sort()).toEqual(['custom-ws', 'legacy-sse']);
    expect(catalog.servers.map((s) => s.serverId)).toEqual(['modern-http']);
  });

  it('a rejected-transport server never reaches discovery: no tool/prompt/resource entries', () => {
    const catalog = buildCatalog([
      { serverId: 'legacy-sse', origin: 'test-fixture', transport: 'sse' },
    ]);

    expect(catalog.adopted).toEqual([]);
    expect(catalog.adapted).toEqual([]);
  });

  it('stdio and streamable-http are accepted, not rejected', () => {
    const catalog = buildCatalog([
      { serverId: 'a', origin: 'test-fixture', transport: 'stdio' },
      { serverId: 'b', origin: 'test-fixture', transport: 'streamable-http' },
    ]);

    expect(catalog.rejected).toEqual([]);
    expect(catalog.servers.map((s) => s.serverId).sort()).toEqual(['a', 'b']);
  });
});
