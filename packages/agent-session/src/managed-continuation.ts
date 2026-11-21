import { ExecutionRecoveryError, isUniversalValueEqual, randomId } from '@robota-sdk/agent-core';
import type {
  IManagedConnectionBinding,
  IManagedRunProvider,
  IToolSchema,
  TExecutionProvider,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

interface ILiveContinuation {
  provider: TExecutionProvider;
  model: string;
  history: TUniversalMessage[];
  tools: IToolSchema[];
  binding: IManagedConnectionBinding;
}

/** What a managed turn was admitted against; used to fence the provider input and the commit. */
export interface IManagedTurnFence {
  binding: IManagedConnectionBinding;
  history: TUniversalMessage[];
  tools: IToolSchema[];
  model: string;
  epoch: number;
}

function refuse(message: string): ExecutionRecoveryError {
  return new ExecutionRecoveryError('EXECUTION_RECOVERY_REQUIRED', message);
}

/**
 * Host-owned, in-memory record of the one live native connection a Session may continue.
 * It is never persisted, so a reconstructed Session cannot claim a process it does not hold.
 */
export class ManagedContinuation {
  private live: ILiveContinuation | undefined;
  private poisoned = false;
  private epoch = 0;

  /** End continuation because history, provider, model or code state moved outside a turn. */
  end(): void {
    this.live = undefined;
    this.epoch += 1;
  }

  /** Decide whether a turn may start, and bind it to the committed host prefix. */
  admit(input: {
    sessionId: string;
    provider: IManagedRunProvider;
    model: string;
    history: TUniversalMessage[];
    tools: IToolSchema[];
    hasStore: boolean;
  }): IManagedTurnFence {
    const { provider, model, history, tools } = input;
    const liveProvider = provider.continuation === 'live-process';
    if (liveProvider && !input.hasStore)
      throw refuse('Managed live continuation requires a committed conversation store');
    const fresh: IManagedConnectionBinding = {
      version: 1,
      sessionId: input.sessionId,
      connectionId: randomId(),
      revision: 0,
      actionFrontier: [],
      frameIds: [],
    };
    const fence = (binding: IManagedConnectionBinding): IManagedTurnFence => ({
      binding,
      history,
      tools,
      model,
      epoch: this.epoch,
    });
    if (!history.some((entry) => entry.role !== 'system')) {
      this.live = undefined;
      this.poisoned = false;
      return fence(fresh);
    }
    if (!liveProvider) throw refuse('Managed provider cannot continue an existing conversation');
    if (this.poisoned)
      throw refuse('A previous managed native connection ended without a committed continuation');
    const prior = this.live;
    if (!prior)
      throw refuse('Managed live continuation has ended and cannot be rebuilt from history');
    if (prior.provider !== provider)
      throw refuse('Managed continuation belongs to a different provider');
    if (prior.model !== model) throw refuse('Managed continuation belongs to a different model');
    if (!isUniversalValueEqual(prior.history, history))
      throw refuse('Managed continuation history differs from the committed host prefix');
    if (!isUniversalValueEqual(prior.tools, tools))
      throw refuse('Managed continuation tool projection changed');
    return fence(prior.binding);
  }

  /** A live connection stays unusable until its turn commits; a failed turn leaves it so. */
  begin(provider: IManagedRunProvider): void {
    if (provider.continuation !== 'live-process') return;
    this.live = undefined;
    this.poisoned = true;
  }

  /** Record the committed prefix. Never throws: the turn is already committed. */
  commit(
    fence: IManagedTurnFence,
    committed: {
      provider: TExecutionProvider;
      model: string;
      history: TUniversalMessage[];
      tools: IToolSchema[];
      settledActions: readonly string[];
      frameIds: readonly string[];
    },
  ): void {
    if (fence.epoch !== this.epoch) return;
    const actionFrontier = [...fence.binding.actionFrontier, ...committed.settledActions];
    const frameIds = [...fence.binding.frameIds, ...committed.frameIds];
    if (
      new Set(actionFrontier).size !== actionFrontier.length ||
      new Set(frameIds).size !== frameIds.length
    )
      return;
    this.live = {
      provider: committed.provider,
      model: committed.model,
      history: structuredClone(committed.history),
      tools: structuredClone(committed.tools),
      binding: {
        ...fence.binding,
        revision: fence.binding.revision + 1,
        actionFrontier,
        frameIds,
      },
    };
    this.poisoned = false;
  }
}
