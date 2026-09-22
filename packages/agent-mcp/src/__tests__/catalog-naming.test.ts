/**
 * TC-03 — canonical naming and its collisions (MCP-002).
 *
 * `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-naming.test.ts` must show: two
 * servers exposing the same tool name both resolve to distinct `<server>__<tool>` names,
 * characters outside `[A-Za-z0-9_-]` become `_`, a name over the 64-character budget is
 * middle-truncated deterministically, and a residual collision records the loser as `rejected`
 * with a reason.
 */

import { describe, expect, it } from 'vitest';

import { canonicalName, resolveNameCollisions } from '../catalog/naming.js';
import { MCP_CANONICAL_NAME_BUDGET } from '../catalog/types.js';

describe('canonicalName', () => {
  it('prefixes unconditionally with <server>__<source>', () => {
    const result = canonicalName('weather', 'get_forecast');
    expect(result.name).toBe('weather__get_forecast');
    expect(result.changed).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('two servers exposing the same tool name resolve to distinct canonical names', () => {
    const a = canonicalName('weather-east', 'lookup');
    const b = canonicalName('weather-west', 'lookup');
    expect(a.name).not.toBe(b.name);
    expect(a.name).toBe('weather-east__lookup');
    expect(b.name).toBe('weather-west__lookup');
  });

  it('sanitises every character outside [A-Za-z0-9_-] in the server id to _', () => {
    const result = canonicalName('weather.io/east', 'lookup');
    expect(result.name).toBe('weather_io_east__lookup');
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('renamed');
  });

  it('sanitises every character outside [A-Za-z0-9_-] in the source name to _', () => {
    const result = canonicalName('weather', 'get forecast (v2)');
    expect(result.name).toBe('weather__get_forecast__v2_');
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('renamed');
  });

  it('a name at or under the budget is left as-is', () => {
    const serverId = 'srv';
    const sourceName = 'x'.repeat(MCP_CANONICAL_NAME_BUDGET - serverId.length - 2);
    const result = canonicalName(serverId, sourceName);
    expect(result.name.length).toBe(MCP_CANONICAL_NAME_BUDGET);
    expect(result.changed).toBe(false);
  });

  const LONG_SERVER = `server-${'x'.repeat(40)}`;
  const LONG_TOOL = `tool-${'y'.repeat(40)}`;

  it('a name over the budget is middle-truncated to fit exactly', () => {
    const result = canonicalName(LONG_SERVER, LONG_TOOL);
    expect(`${LONG_SERVER}__${LONG_TOOL}`.length).toBeGreaterThan(MCP_CANONICAL_NAME_BUDGET);
    expect(result.name.length).toBeLessThanOrEqual(MCP_CANONICAL_NAME_BUDGET);
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('truncated');
  });

  it('truncation is deterministic: the same input always produces the same output', () => {
    const first = canonicalName(LONG_SERVER, LONG_TOOL);
    const second = canonicalName(LONG_SERVER, LONG_TOOL);
    expect(first.name).toBe(second.name);
  });

  it('distinct long names that share a head and tail still diverge after truncation', () => {
    const sharedPrefix = 'x'.repeat(30);
    const sharedSuffix = 'z'.repeat(30);
    const a = canonicalName(LONG_SERVER, `${sharedPrefix}-one-${sharedSuffix}`);
    const b = canonicalName(LONG_SERVER, `${sharedPrefix}-two-${sharedSuffix}`);
    expect(a.name.length).toBeLessThanOrEqual(MCP_CANONICAL_NAME_BUDGET);
    expect(b.name.length).toBeLessThanOrEqual(MCP_CANONICAL_NAME_BUDGET);
    expect(a.name).not.toBe(b.name);
  });

  it('sanitising AND truncating together is reported as both', () => {
    const result = canonicalName(`weather.io/${LONG_SERVER}`, `get forecast (v2) ${LONG_TOOL}`);
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('renamed, truncated');
  });

  it('a custom budget is honoured', () => {
    const result = canonicalName('srv', 'toolname', 10);
    expect(result.name.length).toBeLessThanOrEqual(10);
  });
});

describe('resolveNameCollisions', () => {
  it('no collision: every candidate wins its own name', () => {
    const { winners, losers } = resolveNameCollisions([
      { key: 'a', name: 'srv-a__tool' },
      { key: 'b', name: 'srv-b__tool' },
    ]);
    expect(winners.get('a')).toBe('srv-a__tool');
    expect(winners.get('b')).toBe('srv-b__tool');
    expect(losers).toEqual([]);
  });

  it('a residual collision records the LATER (by key) candidate as the loser, with a reason', () => {
    const { winners, losers } = resolveNameCollisions([
      { key: 'b-server::tool::x', name: 'collided' },
      { key: 'a-server::tool::x', name: 'collided' },
    ]);
    expect(winners.get('a-server::tool::x')).toBe('collided');
    expect(winners.has('b-server::tool::x')).toBe(false);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({
      key: 'b-server::tool::x',
      name: 'collided',
      reason: 'collides with a-server::tool::x after sanitisation/truncation',
    });
  });

  it('sorts by key, independent of input order', () => {
    const first = resolveNameCollisions([
      { key: 'z', name: 'same' },
      { key: 'a', name: 'same' },
    ]);
    const second = resolveNameCollisions([
      { key: 'a', name: 'same' },
      { key: 'z', name: 'same' },
    ]);
    expect(first.winners.get('a')).toBe('same');
    expect(second.winners.get('a')).toBe('same');
    expect(first.losers[0]?.key).toBe('z');
    expect(second.losers[0]?.key).toBe('z');
  });

  it('three-way collision: exactly one winner, two losers', () => {
    const { winners, losers } = resolveNameCollisions([
      { key: '1', name: 'dup' },
      { key: '2', name: 'dup' },
      { key: '3', name: 'dup' },
    ]);
    expect(winners.size).toBe(1);
    expect(losers).toHaveLength(2);
  });
});
