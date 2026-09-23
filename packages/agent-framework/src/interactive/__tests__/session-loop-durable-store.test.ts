import { describe, expect, it, vi } from 'vitest';

import { DurableSessionLoopStore } from '../session-loop-durable-store.js';
import { createSelfPacedLoopState } from '../session-loop-transitions.js';

const created = createSelfPacedLoopState('loop_1', 'Check CI', 1_790_208_000_000);

describe('durable self-paced loop commits', () => {
  it('publishes the new generation only after the strict write succeeds', () => {
    const persisted = vi.fn();
    const store = new DurableSessionLoopStore([], {
      persist: persisted,
      readCommitted: () => [],
    });
    store.commit(created);
    expect(persisted).toHaveBeenCalledWith([created]);
    expect(store.get(created.loopId)).toEqual(created);
  });

  it('does not publish a definitively rejected write', () => {
    const store = new DurableSessionLoopStore([], {
      persist: () => {
        throw new Error('disk full');
      },
      readCommitted: () => [],
    });
    expect(() => store.commit(created)).toThrow('disk full');
    expect(store.get(created.loopId)).toBeUndefined();
  });

  it('accepts a write that reached disk before save reported an error', () => {
    let disk: typeof created[] = [];
    const store = new DurableSessionLoopStore([], {
      persist: (candidate) => {
        disk = [...candidate] as typeof created[];
        throw new Error('post-rename inspection failed');
      },
      readCommitted: () => disk,
    });
    store.commit(created);
    expect(store.get(created.loopId)).toEqual(created);
  });

  it('suspends further admission when a write outcome cannot be read back', () => {
    const store = new DurableSessionLoopStore([], {
      persist: () => {
        throw new Error('unknown disk outcome');
      },
      readCommitted: () => undefined,
    });
    expect(() => store.commit(created)).toThrow('uncertain');
    expect(store.isSuspended()).toBe(true);
    expect(() => store.commit(created)).toThrow('suspended');
  });
});
