import { randomUUID } from 'node:crypto';
import { Session } from '@robota-sdk/agent-session';
import type {
  IRecoverableExecutionJournal,
  IToolWaitRequest,
  ISpinner,
  ITerminalOutput,
} from '@robota-sdk/agent-core';
import type { ISessionOptions, TSessionExecutionResult } from '@robota-sdk/agent-session';
import type {
  AgentParticipant,
  JsonValue,
  ParticipantExecutionOptions,
  ParticipantOutcome,
  ParticipantResponse,
  ParticipantSession,
  ParticipantTurn,
  RuntimeReference,
} from '@robota-sdk/agent-roundtable';
import { createDeltaQueue } from './delta-queue';
import {
  AGENT_SESSION_CHECKPOINT_VERSION,
  decodeSessionCheckpoint,
  encodeSessionCheckpoint,
  type SessionCheckpointState,
} from './checkpoint-codec';
import {
  clearInProcessJournal,
  createInProcessJournal,
  forgetInProcessJournal,
} from './in-process-journal';
import { meterRecoverableJournal } from './metering-journal';
import { toCompletionOutcome } from './outcome';
import { RuntimeParticipantError } from './errors';
import { claimLease } from './resource-guard';
import { renderSharedIncrement, type TurnRenderer } from './render';
import type { OpenContext } from './open-context';

export type { OpenContext } from './open-context';

/** `ISessionOptions` minus the fields this adapter owns: identity, streaming and terminal I/O. */
export type SessionHostOptions = Omit<ISessionOptions, 'sessionId' | 'onTextDelta' | 'terminal'> & {
  terminal?: ITerminalOutput;
};

export interface SessionParticipantOptions {
  id: string;
  description?: string;
  runtime: RuntimeReference;
  createSessionOptions(ctx: OpenContext): SessionHostOptions | Promise<SessionHostOptions>;
  /** A durable journal keyed by this Session; default is an in-process one, kept for this process. */
  journal?(ctx: OpenContext & { sessionId: string }): IRecoverableExecutionJournal;
  render?: TurnRenderer;
}

const noopSpinner: ISpinner = { stop() {}, update() {} };

/** A headless participant has no interactive surface; a prompt outside the wait protocol refuses. */
const headlessTerminal: ITerminalOutput = {
  write() {},
  writeLine() {},
  writeMarkdown() {},
  writeError() {},
  async prompt(): Promise<string> {
    throw new Error('sessionParticipant has no interactive terminal for a live prompt');
  },
  async select(): Promise<number> {
    throw new Error('sessionParticipant has no interactive terminal for a live prompt');
  },
  spinner() {
    return noopSpinner;
  },
};

const APPROVAL_WAIT_KIND = 'robota-session/approval';

interface ApprovalRequestData {
  arguments: JsonValue;
}

function freshState(cwd: string): SessionCheckpointState {
  return { sessionId: randomUUID(), cwd, firstTurnDone: false, history: null, pending: null };
}

function toWaitOutcome(
  requests: readonly IToolWaitRequest[],
): ParticipantOutcome & { kind: 'wait' } {
  const unsupported = requests.find((request) => request.kind !== APPROVAL_WAIT_KIND);
  if (unsupported)
    throw new RuntimeParticipantError(
      'unsupported-wait',
      `Session raised an unsupported wait kind: ${unsupported.kind}`,
    );
  return {
    kind: 'wait',
    requests: requests.map((request) => ({
      id: request.requestId,
      reason: 'Session tool approval requested',
      kind: 'approval',
      data: {
        executionId: request.executionId,
        actionId: request.actionId,
        parentCallId: request.parentCallId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        arguments: (request.data as unknown as ApprovalRequestData).arguments,
      },
    })),
  };
}

/**
 * Run a ConversationAgent `Session` as an `agent-roundtable` participant.
 *
 * Every provider call the Session makes is admitted and reported through the turn's bound
 * `TurnServices` (see `metering-journal.ts`); only the final response text is ever returned as
 * `speak`, so private history and tool traces never enter the shared transcript. Approval waits
 * raised through `robota-session/approval` map to the roundtable's own `wait`/`resumeTurn`
 * protocol; any other wait kind fails the turn with `RuntimeParticipantError('unsupported-wait')`.
 */
export function sessionParticipant(options: SessionParticipantOptions): AgentParticipant {
  const render = options.render ?? renderSharedIncrement;
  return {
    kind: 'agent',
    id: options.id,
    ...(options.description !== undefined ? { description: options.description } : {}),
    runtime: options.runtime,
    factory: {
      supportsContinuation: true,
      checkpointVersions: [AGENT_SESSION_CHECKPOINT_VERSION],
      modelCalls: 'metered',
      async openSession(context) {
        const restoring = context.checkpoint !== undefined;
        const openCtx: OpenContext = {
          conversationId: context.conversationId,
          participantId: context.participantId,
          restoring,
        };
        const hostOptions = await options.createSessionOptions(openCtx);
        let state: SessionCheckpointState;
        if (context.checkpoint) {
          state = decodeSessionCheckpoint(context.checkpoint);
          if (state.cwd !== hostOptions.cwd)
            throw new RuntimeParticipantError(
              'checkpoint-invalid',
              'Checkpoint cwd does not match the current session options',
            );
        } else {
          state = freshState(hostOptions.cwd);
        }

        const releaseLease = claimLease([
          hostOptions.provider,
          ...hostOptions.tools.map((tool) => tool as object),
        ]);

        let currentSink: ReturnType<typeof createDeltaQueue> | undefined;
        // Lease leak: every step below that can throw — construction, replaying a
        // checkpoint's history, and a host's own `journal()` factory — is inside the one guard
        // that releases the lease on the way out, so a failure here never leaves this provider or
        // these tools permanently unusable to a later `openSession`.
        let session!: Session;
        const usingDefaultJournal = options.journal === undefined;
        let journal: IRecoverableExecutionJournal;
        try {
          session = new Session({
            ...hostOptions,
            sessionId: state.sessionId,
            terminal: hostOptions.terminal ?? headlessTerminal,
            onTextDelta: (delta: string) => {
              currentSink?.push(delta);
            },
          });
          if (state.history) for (const message of state.history) session.injectRawMessage(message);
          journal =
            options.journal?.({ ...openCtx, sessionId: state.sessionId }) ??
            createInProcessJournal(state.sessionId);
        } catch (error) {
          releaseLease();
          if (session) await session.shutdown().catch(() => {});
          throw error;
        }

        let firstTurnDone = state.firstTurnDone;
        let pendingWait: { executionId: string; requestIds: string[] } | null = state.pending;
        let released = false;

        async function settle(
          execOptions: ParticipantExecutionOptions,
          run: (meteredJournal: IRecoverableExecutionJournal) => Promise<TSessionExecutionResult>,
        ): Promise<ParticipantOutcome> {
          const deltaQueue = createDeltaQueue(execOptions.onDelta);
          currentSink = deltaQueue;
          const signal = execOptions.signal;
          try {
            const meteredJournal = meterRecoverableJournal(journal, execOptions.services);
            const result = await run(meteredJournal);
            // An aborted run can resolve instead of rejecting, the way a plain ConversationAgent agent's
            // `agent.run()` always does (see agent-participant.ts) — checking `signal.aborted`
            // only in `catch` below would miss that path, letting a cancelled turn's partial text
            // (or even a stray 'waiting' status racing the abort) be published or parked as if
            // the cancellation never happened. `Session`'s own executeRun already turns that same
            // case into a rejection before it reaches here, so this guard is not what this
            // specific call depends on today, but it keeps the same guarantee for any run or
            // resume call that resolves on abort instead.
            if (signal.aborted) throw signal.reason;
            await deltaQueue.flush();
            if (result.status === 'waiting') {
              const outcome = toWaitOutcome(result.requests);
              firstTurnDone = true;
              pendingWait = {
                executionId: result.requests[0]!.executionId,
                requestIds: result.requests.map((request) => request.requestId),
              };
              return outcome;
            }
            firstTurnDone = true;
            pendingWait = null;
            // The default in-process journal never freed a settled execution's records (full
            // message arrays included) — safe exactly here, because nothing reads them back once
            // this turn settled with no wait parked; a journal a host supplied is left alone,
            // since its lifecycle is the host's to manage.
            if (usingDefaultJournal) clearInProcessJournal(state.sessionId);
            return toCompletionOutcome(result.response);
          } catch (error) {
            if (signal.aborted) throw signal.reason ?? error;
            throw error;
          } finally {
            currentSink = undefined;
          }
        }

        const participantSession: ParticipantSession = {
          async checkpoint() {
            return encodeSessionCheckpoint({
              sessionId: state.sessionId,
              cwd: hostOptions.cwd,
              firstTurnDone,
              history: pendingWait ? null : session.getHistory(),
              pending: pendingWait,
            });
          },
          async runTurn(turn: ParticipantTurn, execOptions: ParticipantExecutionOptions) {
            const text = render(turn, { firstTurn: !firstTurnDone });
            return settle(execOptions, (meteredJournal) =>
              session.runRecoverable(text, {
                executionJournal: meteredJournal,
                signal: execOptions.signal,
              }),
            );
          },
          async resumeTurn(
            turn: ParticipantTurn,
            responses: readonly ParticipantResponse[],
            execOptions: ParticipantExecutionOptions,
          ) {
            const parked = pendingWait;
            if (!parked)
              throw new RuntimeParticipantError(
                'identity-mismatch',
                'No approval wait is parked for this participant',
              );
            const toolResponses = responses.map((entry) => {
              const request = entry.request;
              const response = entry.response;
              if (
                request.kind !== 'approval' ||
                response.kind !== 'approval' ||
                request.turnId !== turn.turnId ||
                request.participantId !== turn.participantId ||
                !parked.requestIds.includes(request.id)
              )
                throw new RuntimeParticipantError(
                  'identity-mismatch',
                  'Approval response does not match the parked wait',
                );
              return {
                requestId: request.id,
                responseId: entry.responseId,
                response: { approved: response.approved },
              };
            });
            const priorRecords = await journal.read(parked.executionId);
            if (priorRecords.length === 0)
              throw new RuntimeParticipantError(
                'journal-missing',
                'No journal records were found for the parked execution',
              );
            return settle(execOptions, (meteredJournal) =>
              session.resumeRecoverable({
                executionId: parked.executionId,
                journal: meteredJournal,
                toolResponses,
                signal: execOptions.signal,
              }),
            );
          },
        };

        return {
          session: participantSession,
          async release() {
            if (released) return;
            released = true;
            releaseLease();
            // Free the module-level map entry itself once this lease ends, unless a wait is
            // still parked — a resumed lease later needs exactly those records, and `settle`
            // above never got to clear them because this execution never settled.
            if (usingDefaultJournal && !pendingWait) forgetInProcessJournal(state.sessionId);
            await session.shutdown();
          },
        };
      },
    },
  };
}
