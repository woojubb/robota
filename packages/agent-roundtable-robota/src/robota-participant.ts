import { ExecutionSuspendedError } from '@robota-sdk/agent-core';
import type { IExecutionJournal, IRunOptions, Robota } from '@robota-sdk/agent-core';
import type {
  AgentParticipant,
  ParticipantExecutionOptions,
  ParticipantTurn,
  ParticipantSession,
  RuntimeReference,
} from '@robota-sdk/agent-roundtable';
import {
  ROBOTA_AGENT_CHECKPOINT_VERSION,
  decodeAgentCheckpoint,
  encodeAgentCheckpoint,
} from './checkpoint-codec';
import { createDeltaQueue } from './delta-queue';
import { meterJournal } from './metering-journal';
import { toCompletionOutcome } from './outcome';
import { RobotaParticipantError } from './errors';
import { claimLease } from './resource-guard';
import { renderSharedIncrement, type TurnRenderer } from './render';
import type { OpenContext } from './open-context';

export type { OpenContext } from './open-context';

export interface RobotaParticipantOptions {
  id: string;
  description?: string;
  runtime: RuntimeReference;
  createAgent(ctx: OpenContext): Robota | Promise<Robota>;
  runOptions?: Pick<IRunOptions, 'maxExecutionRounds' | 'maxSameToolInputs'>;
  render?: TurnRenderer;
}

/** Never persisted or read back; metering only needs somewhere to append the journaled records. */
function discardingJournal(): IExecutionJournal {
  return { append: async () => {} };
}

/**
 * Run a plain `Robota` agent as an `agent-roundtable` participant.
 *
 * Unlike `sessionParticipant`, this offers no wait continuation: a suspended execution (a tool
 * requesting a durable continuation) fails the turn with `RobotaParticipantError('unsupported-wait')`
 * rather than parking one. Every provider call is still admitted and reported through the turn's
 * bound `TurnServices`, and only the final response text is ever returned as `speak`.
 */
export function robotaParticipant(options: RobotaParticipantOptions): AgentParticipant {
  const render = options.render ?? renderSharedIncrement;
  return {
    kind: 'agent',
    id: options.id,
    ...(options.description !== undefined ? { description: options.description } : {}),
    runtime: options.runtime,
    factory: {
      checkpointVersions: [ROBOTA_AGENT_CHECKPOINT_VERSION],
      modelCalls: 'metered',
      async openSession(context) {
        const restoring = context.checkpoint !== undefined;
        const openCtx: OpenContext = {
          conversationId: context.conversationId,
          participantId: context.participantId,
          restoring,
        };
        const agent = await options.createAgent(openCtx);
        // SHOULD 6: leasing only `agent` protected two participants from driving the SAME Robota
        // object at once, but not from sharing its providers or tools — `agent.destroy()` below
        // closes every provider in `agent.getConfig().aiProviders`, which breaks a second
        // participant still using that provider if a host's `createAgent` closure ever hands the
        // same provider or tool instance to two agents.
        let releaseLease: () => void;
        try {
          const config = agent.getConfig();
          releaseLease = claimLease([agent, ...config.aiProviders, ...(config.tools ?? [])]);
        } catch (error) {
          await agent.destroy().catch(() => {});
          throw error;
        }
        try {
          if (context.checkpoint) {
            const history = decodeAgentCheckpoint(context.checkpoint);
            for (const message of history) agent.injectRawMessage(message);
          }
        } catch (error) {
          releaseLease();
          await agent.destroy().catch(() => {});
          throw error;
        }

        let firstTurnDone = restoring;
        let currentSink: ReturnType<typeof createDeltaQueue> | undefined;
        let released = false;

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
              const meteredJournal = meterJournal(discardingJournal(), execOptions.services);
              const response = await agent.run(text, {
                signal,
                executionJournal: meteredJournal,
                onTextDelta: (delta: string) => currentSink?.push(delta),
                ...(options.runOptions ?? {}),
              });
              // MUST 3: an aborted run RESOLVES, not rejects — agent-core reports the text it had
              // committed so far, with the turn's messages marked `interrupted` (see CORE-027) —
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
                throw new RobotaParticipantError(
                  'unsupported-wait',
                  'robotaParticipant does not support a suspended execution',
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
            if (released) return;
            released = true;
            releaseLease();
            await agent.destroy();
          },
        };
      },
    },
  };
}
