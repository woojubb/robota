import { describe, expect, it, vi } from 'vitest';

import { AgentFactory } from './agent-factory';
import { isRegistryTransactionError, runRegistryTransaction } from './registry-transaction';

import type { IAgent, IAgentConfig } from '../interfaces/agent';
import type { IAIProvider } from '../interfaces/provider';

/**
 * ARCH-055 (#2159): the registry-owned lifecycle is one transaction — admission before the first
 * await, commit after every fallible step, reverse rollback, primary error preserved.
 */

/** An agent whose `initialize` blocks until released, and which records its `cleanup`. */
function createBlockingAgentClass(): {
  AgentClass: new (config: IAgentConfig) => IAgent<IAgentConfig>;
  release: () => void;
  cleanups: number[];
} {
  let releaseAll: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  const cleanups: number[] = [];
  let sequence = 0;
  class BlockingAgent {
    readonly id = (sequence += 1);
    constructor(readonly config: IAgentConfig) {}
    async initialize(): Promise<void> {
      await gate;
    }
    async cleanup(): Promise<void> {
      cleanups.push(this.id);
    }
  }
  return {
    AgentClass: BlockingAgent as unknown as new (config: IAgentConfig) => IAgent<IAgentConfig>,
    release: () => releaseAll(),
    cleanups,
  };
}

const config: Partial<IAgentConfig> = {
  name: 'tx',
  aiProviders: [{ name: 'mock', version: '0' } as unknown as IAIProvider],
  defaultModel: { provider: 'mock', model: 'mock-model' },
};

describe('runRegistryTransaction', () => {
  it('rolls back completed steps in reverse and preserves the primary error', async () => {
    const order: string[] = [];
    const primary = new TypeError('step three failed');
    const undoFailure = new Error('undo two failed');
    await expect(
      runRegistryTransaction([
        {
          name: 'one',
          run: () => {
            order.push('one');
          },
          undo: () => {
            order.push('undo one');
          },
        },
        {
          name: 'two',
          run: () => {
            order.push('two');
          },
          undo: () => {
            order.push('undo two');
            throw undoFailure;
          },
        },
        {
          name: 'three',
          run: () => {
            throw primary;
          },
          undo: () => {
            order.push('never');
          },
        },
      ]),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBe(primary); // the original object, so `instanceof TypeError` still holds
      expect(isRegistryTransactionError(error)).toBe(true);
      if (isRegistryTransactionError(error)) {
        expect(error.failedStep).toBe('three');
        expect(error.rollbackErrors).toEqual([{ step: 'two', error: undoFailure }]);
      }
      return true;
    });
    expect(order).toEqual(['one', 'two', 'undo two', 'undo one']);
  });
});

describe('AgentFactory transactional lifecycle (ARCH-055)', () => {
  it('counts pending creates toward the limit: a shared-barrier race admits exactly the limit', async () => {
    const { AgentClass, release } = createBlockingAgentClass();
    const factory = new AgentFactory({ maxConcurrentAgents: 2, strictValidation: false });

    const attempts = [1, 2, 3, 4].map(() =>
      factory.createAgent(AgentClass, config).then(
        () => 'created',
        (error: Error) => error.message,
      ),
    );
    release();
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(2);
    expect(outcomes.filter((outcome) => /limit reached/.test(outcome))).toHaveLength(2);
    expect(factory.getActiveAgents().size).toBe(2);
  });

  it('retries a colliding id and never overwrites an active or pending registration', async () => {
    const { AgentClass, release } = createBlockingAgentClass();
    // A deterministic corpus: the same id three times, then a fresh one — the second create must
    // land on a distinct key even though the first is still pending when it is admitted.
    const corpus = ['dup', 'dup', 'dup', 'fresh'];
    const factory = new AgentFactory({
      maxConcurrentAgents: 4,
      strictValidation: false,
      idFactory: () => corpus.shift() ?? 'exhausted',
    });

    const first = factory.createAgent(AgentClass, config);
    const second = factory.createAgent(AgentClass, config);
    release();
    await Promise.all([first, second]);

    expect(factory.getActiveAgents().size).toBe(2);
  });

  it('a failing afterCreate cleans up the initialized agent, unregisters it, and reverses stats', async () => {
    const { AgentClass, release, cleanups } = createBlockingAgentClass();
    const primary = new Error('afterCreate refused');
    const factory = new AgentFactory(
      { maxConcurrentAgents: 1, strictValidation: false },
      { afterCreate: vi.fn().mockRejectedValueOnce(primary) },
    );
    release();

    await expect(factory.createAgent(AgentClass, config)).rejects.toBe(primary);

    expect(cleanups).toHaveLength(1);
    expect(factory.getActiveAgents().size).toBe(0);
    expect(factory.getCreationStats()).toMatchObject({ activeCount: 0, totalCreated: 0 });
    // The slot is released: the next create is admitted under the same limit of 1.
    const { AgentClass: Second, release: releaseSecond } = createBlockingAgentClass();
    releaseSecond();
    await expect(
      new AgentFactory({ maxConcurrentAgents: 1, strictValidation: false }).createAgent(
        Second,
        config,
      ),
    ).resolves.toBeDefined();
    await expect(factory.createAgent(Second, config)).resolves.toBeDefined();
  });
});
