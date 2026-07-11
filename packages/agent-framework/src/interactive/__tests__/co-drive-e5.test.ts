import { AGENT_DRIVER_ID, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';
import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
} from '@robota-sdk/agent-interface-transport';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PENDING_QUEUE_DEPTH,
  SessionExecutionController,
  type IQueuedInput,
} from '../interactive-session-execution-controller.js';
import { SessionPromptRegistry } from '../session-prompt-registry.js';

/**
 * REMOTE-014 E5 — the co-drive queue (same-driver coalesce vs cross-driver append + drop-newest + wakeTaskId
 * release) and the prompt registry's requester/answerer attribution.
 */

function controller(): SessionExecutionController {
  // enqueuePending/clearPendingQueue don't touch the injected deps — construct with minimal stubs.
  return new SessionExecutionController({} as never, {} as never, { emit: vi.fn() } as never);
}

function entry(input: string, driverId: string, wakeTaskId?: string): IQueuedInput {
  return { input, options: { driverId, ...(wakeTaskId ? { wakeTaskId } : {}) } };
}

describe('co-drive queue (REMOTE-014 TC-01)', () => {
  it('same-driver submits COALESCE (tail-replace, 1-deep); a different driver APPENDS (no clobber)', () => {
    const c = controller();
    expect(c.enqueuePending(entry('a1', OWNER_DRIVER_ID))).toBe('queued');
    expect(c.enqueuePending(entry('a2', OWNER_DRIVER_ID))).toBe('coalesced'); // same driver → replace tail
    expect(c.pendingCount()).toBe(1);
    expect(c.pendingPrompt).toBe('a2'); // last-wins for the same driver

    expect(c.enqueuePending(entry('b1', 'device-B'))).toBe('queued'); // different driver → append
    expect(c.pendingCount()).toBe(2);
    expect(c.pendingQueue.map((e) => e.input)).toEqual(['a2', 'b1']); // submission order preserved
  });

  it('drops-newest at MAX_PENDING_QUEUE_DEPTH (attributed notice is the caller’s job)', () => {
    const c = controller();
    for (let i = 0; i < MAX_PENDING_QUEUE_DEPTH; i += 1) {
      expect(c.enqueuePending(entry(`m${i}`, `driver-${i}`))).toBe('queued');
    }
    expect(c.enqueuePending(entry('overflow', 'driver-X'))).toBe('dropped');
    expect(c.pendingCount()).toBe(MAX_PENDING_QUEUE_DEPTH);
  });

  it('clearPendingQueue releases EVERY entry’s wakeTaskId (CORE-024) and returns the cleared drivers', () => {
    const c = controller();
    c.wakeTaskIds.add('t1');
    c.wakeTaskIds.add('t2');
    c.enqueuePending(entry('x', 'device-A', 't1'));
    c.enqueuePending(entry('y', 'device-B', 't2'));
    const cleared = c.clearPendingQueue();
    expect(c.pendingCount()).toBe(0);
    expect(c.wakeTaskIds.has('t1')).toBe(false); // gate freed — a future wake for t1 is not locked out
    expect(c.wakeTaskIds.has('t2')).toBe(false);
    expect(cleared.sort()).toEqual(['device-A', 'device-B']);
  });
});

describe('prompt registry attribution (REMOTE-014 TC-04)', () => {
  it('stamps requesterDriverId (active turn) on the request and answererDriverId on resolve', () => {
    let activeDriver: string | null = 'driver-A';
    const permission: IPermissionRequestEvent[] = [];
    const resolved: IPromptResolvedEvent[] = [];
    const registry = new SessionPromptRegistry({
      emitPermissionRequest: (e) => permission.push(e),
      emitAskRequest: (_e: IAskRequestEvent) => undefined,
      emitPromptResolved: (e) => resolved.push(e),
      countListeners: () => 1, // a surface is subscribed → the prompt parks
      getActiveDriverId: () => activeDriver,
    });

    void registry.requestPermission('write_file', { path: 'x' } as never);
    expect(permission[0]?.requesterDriverId).toBe('driver-A'); // the active turn's driver

    activeDriver = null; // (answer arrives after the turn's driver context is irrelevant)
    registry.resolvePermission(permission[0].id, true, 'device-B'); // a remote surface answered
    expect(resolved[0]?.answererDriverId).toBe('device-B');
  });

  it('an agent turn stamps the reserved agent id, not the owner', () => {
    const permission: IPermissionRequestEvent[] = [];
    const registry = new SessionPromptRegistry({
      emitPermissionRequest: (e) => permission.push(e),
      emitAskRequest: () => undefined,
      emitPromptResolved: () => undefined,
      countListeners: () => 1,
      getActiveDriverId: () => AGENT_DRIVER_ID,
    });
    void registry.requestPermission('shell', {} as never);
    expect(permission[0]?.requesterDriverId).toBe(AGENT_DRIVER_ID);
    expect(permission[0]?.requesterDriverId).not.toBe(OWNER_DRIVER_ID);
  });
});
