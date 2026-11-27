import { ExecutionSuspendedError } from '@robota-sdk/agent-core';
import type { IExecutionJournal, IRunOptions, ConversationAgent } from '@robota-sdk/agent-core';
import type {
  AgentParticipant,
  ParticipantExecutionOptions,
  ParticipantTurn,
  ParticipantSession,
  RuntimeReference,
} from '@robota-sdk/agent-roundtable';
import {
  RUNTIME_AGENT_CHECKPOINT_VERSION,
  decodeAgentCheckpoint,
  encodeAgentCheckpoint,
} from './checkpoint-codec';
import { createDeltaQueue } from './delta-queue';
import { meterJournal } from './metering-journal';
import {
  assertCallsAreBounded,
  normalizeEnforcement,
  type RuntimeEnforcement,
} from './enforcement';
import { toCompletionOutcome } from './outcome';
import { RuntimeParticipantError } from './errors';
import { claimLease } from './resource-guard';
import { renderSharedIncrement, type TurnRenderer } from './render';
import { assertCallersAreMetered } from './unmetered-callers';
import type { OpenContext } from './open-context';

export type { OpenContext } from './open-context';

export interface RuntimeParticipantOptions {
  id: string;
  description?: string;
  runtime: RuntimeReference;
  createAgent(ctx: OpenContext): ConversationAgent | Promise<ConversationAgent>;
  runOptions?: Pick<IRunOptions, 'maxExecutionRounds' | 'maxSameToolInputs'>;
  render?: TurnRenderer;
  /**
   * Declares that every provider call can be bounded before dispatch. With it the participant
   * declares `modelCalls: 'enforced'` and is admitted under a budget; without it, `'metered'`.
   */
  enforcement?: RuntimeEnforcement;
}

/** Never persisted or read back; metering only needs somewhere to append the journaled records. */
function discardingJournal(): IExecutionJournal {
  return { append: async () => {} };
}

/**
 * Run a plain `ConversationAgent` agent as an `agent-roundtable` participant.
 *
 * Unlike `sessionParticipant`, this offers no wait continuation: a suspended execution (a tool
 * requesting a durable continuation) fails the turn with `RuntimeParticipantError('unsupported-wait')`
 * rather than parking one. Every provider call is still admitted and reported through the turn's
 * bound `TurnServices`, and only the final response text is ever returned as `speak`.
 */
export function runtimeParticipant(options: RuntimeParticipantOptions): AgentParticipant {
  const render = options.render ?? renderSharedIncrement;
  const enforcement = options.enforcement && normalizeEnforcement(options.enforcement);
  return {
    kind: 'agent',
    id: options.id,
    ...(options.description !== undefined ? { description: options.description } : {}),
    runtime: options.runtime,
    factory: {
      checkpointVersions: [RUNTIME_AGENT_CHECKPOINT_VERSION],
      modelCalls: enforcement ? 'enforced' : 'metered',
      async openSession(context) {
        const restoring = context.checkpoint !== undefined;
        const openCtx: OpenContext = {
          conversationId: context.conversationId,
          participantId: context.participantId,
          restoring,
        };
        const agent = await options.createAgent(openCtx);
        // Borrowing changes close responsibility, never exclusive-use requirements.
        // A refused claim must not destroy resources another live lease still holds.
        const config = agent.getConfig();
        try {
          assertCallersAreMetered({ providers: config.aiProviders });
          if (enforcement)
            assertCallsAreBounded({
              providers: config.aiProviders,
              outputCap: config.defaultModel.maxTokens,
              outputCapField: 'defaultModel.maxTokens',
              toolNames: (config.tools ?? []).map((tool) => tool.getName()),
              enforcement,
            });
        } catch (error) {
          await agent.destroy().catch(() => {});
          throw error;
        }
        const releaseLease = claimLease([agent, ...config.aiProviders, ...(config.tools ?? [])]);
        try {
          if (context.checkpoint) {
            const history = decodeAgentCheckpoint(context.checkpoint);
            for (const message of history) agent.injectRawMessage(message);
          }
        } catch (error) {
          try {
            await agent.destroy().catch(() => {});
          } finally {
            releaseLease();
          }
          throw error;
        }

        let firstTurnDone = restoring;
        let currentSink: ReturnType<typeof createDeltaQueue> | undefined;
        let releasePromise: Promise<void> | undefined;

        const participantSession: ParticipantSession = {
          async checkpoint() {
            return encodeAgentCheckpoint(agent.getHistory());
          },
          async runTurn(turn: ParticipantTurn, execOptions: ParticipantExecutionOptions) {
            const text = render(turn, { firstTurn: !firstTurnDone });
            const deltaQueue = createDeltaQueue(execOptions.onDelta);
            currentSink = deltaQueue;
            const signal = execOptions.signal;
            try {
              const meteredJournal = meterJournal(
                discardingJournal(),
                execOptions.services,
                options.enforcement,
              );
              const response = await agent.run(text, {
                signal,
                executionJournal: meteredJournal,
                onTextDelta: (delta: string) => currentSink?.push(delta),
                ...(options.runOptions ?? {}),
              });
              // An aborted run RESOLVES, not rejects — agent-core reports the text it had
              // committed so far, with the turn's messages marked `interrupted` —
              // so a check only in `catch` below never sees this. Publishing that partial text as
              // this turn's `speak` would let a cancelled turn's words reach the shared transcript
              // next run; the caller cancelled specifically to prevent that.
              if (signal.aborted) throw signal.reason;
              await deltaQueue.flush();
              firstTurnDone = true;
              return toCompletionOutcome(response);
            } catch (error) {
              if (signal.aborted) throw signal.reason ?? error;
              if (error instanceof ExecutionSuspendedError)
                throw new RuntimeParticipantError(
                  'unsupported-wait',
                  'runtimeParticipant does not support a suspended execution',
                );
              throw error;
            } finally {
              currentSink = undefined;
            }
          },
        };

        return {
          session: participantSession,
          async release() {
            releasePromise ??= (async () => {
              try {
                await agent.destroy();
              } finally {
                releaseLease();
              }
            })();
            await releasePromise;
          },
        };
      },
    },
  };
}
