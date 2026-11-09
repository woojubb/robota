import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { handleSurfaceRoleMessage, resolveSurfaceRole } from '../surface-role.js';

describe('resolveSurfaceRole', () => {
  it.each([
    ['drive', undefined, { ok: true, role: 'drive' }],
    ['drive', 'drive', { ok: true, role: 'drive' }],
    ['drive', 'observe', { ok: true, role: 'observe' }],
    ['drive', '', { ok: false, reason: 'unsupported-role' }],
    ['drive', 'admin', { ok: false, reason: 'unsupported-role' }],
    ['drive', 42, { ok: false, reason: 'unsupported-role' }],
    ['drive', null, { ok: false, reason: 'unsupported-role' }],
    ['observe', undefined, { ok: true, role: 'observe' }],
    ['observe', 'drive', { ok: false, reason: 'role-not-granted' }],
    ['observe', 'observe', { ok: true, role: 'observe' }],
    ['observe', '', { ok: false, reason: 'unsupported-role' }],
    ['observe', 'admin', { ok: false, reason: 'unsupported-role' }],
    ['observe', 42, { ok: false, reason: 'unsupported-role' }],
    ['observe', null, { ok: false, reason: 'unsupported-role' }],
  ] as const)('grant %s, request %j', (grant, request, expected) => {
    expect(resolveSurfaceRole(grant, request)).toEqual(expected);
  });
});

function boundary(): { deliver: ReturnType<typeof createOutboundDelivery>; sent: unknown[] } {
  const sent: unknown[] = [];
  return { deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()), sent };
}

describe('handleSurfaceRoleMessage', () => {
  it('answers get-surface-role with the role, even for an observer', () => {
    const { deliver, sent } = boundary();
    expect(handleSurfaceRoleMessage('observe', { type: 'get-surface-role' }, deliver)).toBe(true);
    expect(sent).toEqual([{ type: 'surface_role', role: 'observe' }]);
  });

  it('leaves other messages to the caller for a driver, and for an observer when they are reads', () => {
    const { deliver, sent } = boundary();
    expect(handleSurfaceRoleMessage('drive', { type: 'abort' }, deliver)).toBe(false);
    expect(handleSurfaceRoleMessage('observe', { type: 'get-status' }, deliver)).toBe(false);
    expect(sent).toEqual([]);
  });
});
