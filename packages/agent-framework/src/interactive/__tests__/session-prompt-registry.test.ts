import { describe, expect, it, vi } from 'vitest';

import {
  SessionPromptRegistry,
  type ISessionPromptRegistryDeps,
} from '../session-prompt-registry.js';

import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
} from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-007 (B4-2a) — the transport-neutral pending-prompt registry. A stub emitter with a
 * controllable per-event listener count drives every fail-closed path deterministically (no timers
 * except the dedicated backstop test).
 */

interface IHarness {
  registry: SessionPromptRegistry;
  permissionEvents: IPermissionRequestEvent[];
  askEvents: IAskRequestEvent[];
  resolvedEvents: IPromptResolvedEvent[];
  /** Set the live listener count the registry reads for a gating event. */
  setListeners(event: 'permission_request' | 'ask_request', n: number): void;
}

function harness(backstopMs?: number): IHarness {
  const counts: Record<'permission_request' | 'ask_request', number> = {
    permission_request: 1,
    ask_request: 1,
  };
  const permissionEvents: IPermissionRequestEvent[] = [];
  const askEvents: IAskRequestEvent[] = [];
  const resolvedEvents: IPromptResolvedEvent[] = [];
  const deps: ISessionPromptRegistryDeps = {
    emitPermissionRequest: (e) => permissionEvents.push(e),
    emitAskRequest: (e) => askEvents.push(e),
    emitPromptResolved: (e) => resolvedEvents.push(e),
    countListeners: (event) => counts[event],
    ...(backstopMs !== undefined ? { backstopMs } : {}),
  };
  return {
    registry: new SessionPromptRegistry(deps),
    permissionEvents,
    askEvents,
    resolvedEvents,
    setListeners: (event, n) => {
      counts[event] = n;
    },
  };
}

describe('SessionPromptRegistry (REMOTE-007 transport-neutral permission/ask)', () => {
  it('TC-01: a permission request emits `permission_request` and resolvePermission settles it (allow)', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('shell', { cmd: 'ls' });
    expect(h.permissionEvents).toHaveLength(1);
    const { id, toolName, toolArgs } = h.permissionEvents[0]!;
    expect(toolName).toBe('shell');
    expect(toolArgs).toEqual({ cmd: 'ls' });
    h.registry.resolvePermission(id, true);
    await expect(pending).resolves.toBe(true);
    expect(h.resolvedEvents).toEqual([{ id }]);
  });

  it('TC-01: resolvePermission(id, false) denies', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('shell', {});
    h.registry.resolvePermission(h.permissionEvents[0]!.id, false);
    await expect(pending).resolves.toBe(false);
  });

  it('TC-01: an allow-session decision is carried through verbatim', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('edit', {});
    h.registry.resolvePermission(h.permissionEvents[0]!.id, 'allow-session');
    await expect(pending).resolves.toBe('allow-session');
  });

  it('TC-02: an ask request emits `ask_request` and resolveAsk returns the answer', async () => {
    const h = harness();
    const request = { id: 'req-1', title: 'Pick one', options: [{ value: 'a', label: 'A' }] };
    const pending = h.registry.requestAsk(request);
    expect(h.askEvents).toHaveLength(1);
    expect(h.askEvents[0]!.request).toBe(request);
    h.registry.resolveAsk(h.askEvents[0]!.id, { type: 'answer', values: ['a'] });
    await expect(pending).resolves.toEqual({ type: 'answer', values: ['a'] });
  });

  it('TC-02: resolveAsk with cancelled cancels', async () => {
    const h = harness();
    const pending = h.registry.requestAsk({ id: 'r', title: 't' });
    h.registry.resolveAsk(h.askEvents[0]!.id, { type: 'cancelled' });
    await expect(pending).resolves.toEqual({ type: 'cancelled' });
  });

  it('TC-03: fail-closed at emit — a permission with zero listeners is DENIED immediately (never parks)', async () => {
    const h = harness();
    h.setListeners('permission_request', 0);
    const pending = h.registry.requestPermission('shell', {});
    await expect(pending).resolves.toBe(false);
    expect(h.permissionEvents).toHaveLength(0); // never emitted — no surface to render it
    expect(h.registry.pendingCount).toBe(0);
  });

  it('TC-03: fail-closed at emit — an ask with zero listeners resolves cancelled immediately', async () => {
    const h = harness();
    h.setListeners('ask_request', 0);
    const pending = h.registry.requestAsk({ id: 'r', title: 't' });
    await expect(pending).resolves.toEqual({ type: 'cancelled' });
    expect(h.askEvents).toHaveLength(0);
  });

  it('TC-03b: reconcile-on-detach — a parked permission resolves deny when the last surface detaches', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('shell', {});
    expect(h.registry.pendingCount).toBe(1); // parked, awaiting a human
    h.setListeners('permission_request', 0); // the surface unsubscribed
    h.registry.reconcileOnDetach('permission_request');
    await expect(pending).resolves.toBe(false);
    expect(h.registry.pendingCount).toBe(0);
    expect(h.resolvedEvents).toHaveLength(1);
  });

  it('TC-03b: reconcile is a no-op while another surface still listens', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('shell', {});
    h.setListeners('permission_request', 1); // one surface detached, another remains
    h.registry.reconcileOnDetach('permission_request');
    expect(h.registry.pendingCount).toBe(1); // still parked — a live surface can answer
    h.registry.resolvePermission(h.permissionEvents[0]!.id, true);
    await expect(pending).resolves.toBe(true);
  });

  it('TC-03b: reconcile-on-detach for asks only settles parked asks, not parked permissions', async () => {
    const h = harness();
    const perm = h.registry.requestPermission('shell', {});
    const ask = h.registry.requestAsk({ id: 'r', title: 't' });
    h.setListeners('ask_request', 0);
    h.registry.reconcileOnDetach('ask_request');
    await expect(ask).resolves.toEqual({ type: 'cancelled' });
    expect(h.registry.pendingCount).toBe(1); // the permission is still parked
    h.registry.resolvePermission(h.permissionEvents[0]!.id, true);
    await expect(perm).resolves.toBe(true);
  });

  it('TC-03c: teardown drain — every parked prompt settles fail-closed (deny permissions, cancel asks)', async () => {
    const h = harness();
    const perm = h.registry.requestPermission('shell', {});
    const ask = h.registry.requestAsk({ id: 'r', title: 't' });
    expect(h.registry.pendingCount).toBe(2);
    h.registry.drain();
    await expect(perm).resolves.toBe(false);
    await expect(ask).resolves.toEqual({ type: 'cancelled' });
    expect(h.registry.pendingCount).toBe(0);
  });

  it('TC-04: co-drive — the first resolve wins, emits prompt_resolved, and a late resolve is a no-op', async () => {
    const h = harness();
    const pending = h.registry.requestPermission('shell', {});
    const { id } = h.permissionEvents[0]!;
    h.registry.resolvePermission(id, true); // surface A answers first
    h.registry.resolvePermission(id, false); // surface B answers late → ignored
    await expect(pending).resolves.toBe(true);
    expect(h.resolvedEvents).toEqual([{ id }]); // exactly one dismissal
  });

  it('TC-04: a resolveAsk for a permission id is ignored (kind-guarded), and vice versa', async () => {
    const h = harness();
    const perm = h.registry.requestPermission('shell', {});
    const permId = h.permissionEvents[0]!.id;
    h.registry.resolveAsk(permId, { type: 'answer', values: ['x'] }); // wrong kind → no-op
    expect(h.registry.pendingCount).toBe(1);
    h.registry.resolvePermission(permId, true);
    await expect(perm).resolves.toBe(true);
  });

  it('resolve for an unknown id is a safe no-op', () => {
    const h = harness();
    expect(() => h.registry.resolvePermission('nope', true)).not.toThrow();
    expect(() => h.registry.resolveAsk('nope', { type: 'cancelled' })).not.toThrow();
    expect(h.resolvedEvents).toHaveLength(0);
  });

  it('backstop timeout — a parked prompt whose surface died without unsubscribing eventually denies', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(1000);
      const pending = h.registry.requestPermission('shell', {});
      expect(h.registry.pendingCount).toBe(1);
      vi.advanceTimersByTime(1000);
      await expect(pending).resolves.toBe(false); // last-resort deny
      expect(h.registry.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backstop timer is cleared once a real answer arrives (no double-settle)', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(1000);
      const pending = h.registry.requestPermission('shell', {});
      h.registry.resolvePermission(h.permissionEvents[0]!.id, true);
      await expect(pending).resolves.toBe(true);
      vi.advanceTimersByTime(5000); // backstop must not fire a second settle
      expect(h.resolvedEvents).toEqual([{ id: h.permissionEvents[0]!.id }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
