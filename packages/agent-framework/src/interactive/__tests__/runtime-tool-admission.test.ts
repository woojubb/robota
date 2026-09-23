import { describe, expect, it, vi } from 'vitest';
import { InteractiveExecutionClaimOwner } from '../interactive-execution-claim.js';
import { PendingInputQueue } from '../interactive-session-pending-queue.js';

describe('canonical runtime tool admission', () => {
  it('holds the same foreground claim and refuses submissions while a direct call drains', () => {
    const owner = new InteractiveExecutionClaimOwner([]);
    const call = owner.acquire('runtime-tool');
    expect(() => owner.beginSubmission()).toThrow(/runtime tool/i);
    expect(() => owner.acquire('runtime-tool')).toThrow(/already running/i);
    owner.complete(call, vi.fn());
    owner.beginSubmission();
    owner.endSubmission();
  });

  it('reserves initialization for an already arriving submission', () => {
    const owner = new InteractiveExecutionClaimOwner([]);
    owner.beginSubmission();
    expect(() => owner.acquire('runtime-tool')).toThrow(/submission/i);
    owner.endSubmission();
    const call = owner.acquire('runtime-tool');
    owner.complete(call, vi.fn());
  });

  it('cancels only the identified queued turn and releases only its wake', () => {
    const refuse = vi.fn();
    const releaseWake = vi.fn();
    const queue = new PendingInputQueue({ refuse, releaseWake });
    queue.enqueue({ turnId: 'a', input: 'a', options: { driverId: 'a', wakeTaskId: 'wa' } });
    queue.enqueue({ turnId: 'b', input: 'b', options: { driverId: 'b', wakeTaskId: 'wb' } });
    expect(queue.cancel('a')).toBe(true);
    expect(queue.contents.map((entry) => entry.turnId)).toEqual(['b']);
    expect(refuse).toHaveBeenCalledExactlyOnceWith('a', 'cancelled');
    expect(releaseWake).toHaveBeenCalledExactlyOnceWith('wa');
    expect(queue.cancel('a')).toBe(false);
  });
});
