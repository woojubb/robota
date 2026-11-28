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
  AttemptRecovery,
  AttemptRecoveryInput,
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
import {
  assertCallsAreBounded,
  normalizeEnforcement,
  type RuntimeEnforcement,
} from './enforcement';
import { classifyAttempt } from './attempt-recovery';
import {
  assertDurableJournal,
  attemptJournal,
  ScopeLog,
  type AttemptJournal,
  type SessionRecoveryOptions,
} from './recovery-journal';
import { settleReconciledEffect, type EffectSettlement } from './effect-settlement';
import { toCompletionOutcome } from './outcome';
import { RuntimeParticipantError } from './errors';
import { claimLease } from './resource-guard';
import { renderSharedIncrement, type TurnRenderer } from './render';
import { assertCallersAreMetered } from './unmetered-callers';
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
  /**
   * Makes the participant reconcilable: a turn a process stopped midway is recovered from this
   * journal instead of rerun, and every call it had admitted is settled, refunded or kept counted.
   * It replaces `journal`, and the Session may use neither automatic compaction nor hooks, which
   * write or run outside it.
   */
  recovery?: SessionRecoveryOptions;
  render?: TurnRenderer;
  /**
   * Declares that every provider call can be bounded before dispatch. With it the participant
   * declares `modelCalls: 'enforced'` and is admitted under a budget; without it, `'metered'`.
   */
  enforcement?: RuntimeEnforcement;
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

/**
 * Automatic compaction writes under an execution id of its own, and hooks run before the first journal
 * record and are skipped when a turn resumes: neither can be recovered from the journal. An in-process
 * prompt handler waits on an answer nothing durable records. A reconcilable participant refuses all of
 * them before it opens anything.
 */
function assertRecoverableSession(hostOptions: SessionHostOptions): void {
  if (hostOptions.autoCompactThreshold !== false)
    throw new RuntimeParticipantError(
      'recovery-unsupported',
      'Automatic compaction runs outside the recovery journal; set `autoCompactThreshold: false`',
    );
  const hooked = Object.values(hostOptions.hooks ?? {}).some(
    (hook) => !(Array.isArray(hook) && hook.length === 0),
  );
  if (hooked)
    throw new RuntimeParticipantError(
      'recovery-unsupported',
      'Hooks run outside the recovery journal and are skipped when a turn resumes',
    );
  for (const option of ['ask', 'permissionHandler', 'promptForApproval'] as const)
    if (hostOptions[option] !== undefined)
      throw new RuntimeParticipantError(
        'recovery-unsupported',
        `\`${option}\` waits for an answer outside the conversation, which a restarted process loses; approvals reach a recoverable participant as conversation wait requests`,
      );
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
  const enforcement =
    options.enforcement !== undefined ? normalizeEnforcement(options.enforcement) : undefined;
  if (options.recovery && options.journal)
    throw new RuntimeParticipantError(
      'invalid-config',
      'A reconcilable sessionParticipant takes its journal from `recovery`, not `journal`',
    );
  const recovery = options.recovery;
  return {
    kind: 'agent',
    id: options.id,
    ...(options.description !== undefined ? { description: options.description } : {}),
    runtime: options.runtime,
    factory: {
      supportsContinuation: true,
      checkpointVersions: [AGENT_SESSION_CHECKPOINT_VERSION],
      modelCalls: enforcement ? 'enforced' : 'metered',
      ...(recovery
        ? {
            recovery: 'reconcilable' as const,
            async reconcile(input: AttemptRecoveryInput): Promise<AttemptRecovery> {
              const journal = recovery.journal({
                conversationId: input.conversationId,
                participantId: input.participantId,
              });
              assertDurableJournal(journal);
              return classifyAttempt({ entries: await journal.read(), input, enforcement });
            },
          }
        : {}),
      async openSession(context) {
        const restoring = context.checkpoint !== undefined;
        const openCtx: OpenContext = {
          conversationId: context.conversationId,
          participantId: context.participantId,
          restoring,
        };
        // Refused first: nothing below may depend on a journal that can lose what it acknowledged.
        const recoveryJournal = recovery?.journal({
          conversationId: context.conversationId,
          participantId: context.participantId,
        });
        if (recoveryJournal) assertDurableJournal(recoveryJournal);
        const hostOptions = await options.createSessionOptions(openCtx);
        // Before the lease and before `new Session`, whose constructor fires SessionStart hooks.
        assertCallersAreMetered({
          providers: [hostOptions.provider],
          permissionClassifier: hostOptions.permissionClassifier,
          hookTypeExecutors: hostOptions.hookTypeExecutors,
        });
        if (recoveryJournal) assertRecoverableSession(hostOptions);
        if (enforcement)
          assertCallsAreBounded({
            providers: [hostOptions.provider],
            outputCap: hostOptions.maxOutputTokens,
            outputCapField: 'maxOutputTokens',
            automaticCompaction: hostOptions.autoCompactThreshold !== false,
            toolNames: hostOptions.tools.map((tool) => tool.getName()),
            enforcement,
          });
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
        const usingDefaultJournal = options.journal === undefined && recoveryJournal === undefined;
        const scopeLog = recoveryJournal ? new ScopeLog(recoveryJournal) : undefined;
        let journal: IRecoverableExecutionJournal | undefined;
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
          if (!scopeLog)
            journal =
              options.journal?.({ ...openCtx, sessionId: state.sessionId }) ??
              createInProcessJournal(state.sessionId);
        } catch (error) {
          try {
            if (session) await session.shutdown().catch(() => {});
          } finally {
            releaseLease();
          }
          throw error;
        }

        let firstTurnDone = state.firstTurnDone;
        let pendingWait: { executionId: string; requestIds: string[] } | null = state.pending;
        let releasePromise: Promise<void> | undefined;
        // Attempts that may still write; each is sealed when its turn settles, the rest on release.
        const writable = new Set<AttemptJournal>();

        function attemptFor(
          turn: ParticipantTurn,
          signal: AbortSignal,
        ): AttemptJournal | undefined {
          if (!scopeLog) return undefined;
          const attempt = attemptJournal(
            scopeLog,
            { attemptId: turn.attemptId, sessionId: state.sessionId, cwd: hostOptions.cwd },
            signal,
          );
          writable.add(attempt);
          return attempt;
        }

        async function settle(
          turn: ParticipantTurn,
          phase: string,
          attempt: AttemptJournal | undefined,
          execOptions: ParticipantExecutionOptions,
          run: (meteredJournal: IRecoverableExecutionJournal) => Promise<TSessionExecutionResult>,
        ): Promise<ParticipantOutcome> {
          const deltaQueue = createDeltaQueue(execOptions.onDelta);
          currentSink = deltaQueue;
          const signal = execOptions.signal;
          try {
            const meteredJournal = meterRecoverableJournal(
              attempt ?? journal!,
              execOptions.services,
              options.enforcement,
              attempt?.effectCalls,
            );
            const result = await run(meteredJournal);
            // A Session that returned finished its turn, whatever stop was observed meanwhile: its
            // outcome is journaled and returned, never discarded. The deltas a stop kept from being
            // delivered are not part of what the turn produced.
            await deltaQueue.flush().catch((error: unknown) => {
              if (!signal.aborted) throw error;
            });
            let outcome: ParticipantOutcome;
            if (result.status === 'waiting') {
              outcome = toWaitOutcome(result.requests);
              firstTurnDone = true;
              pendingWait = {
                executionId: result.requests[0]!.executionId,
                requestIds: result.requests.map((request) => request.requestId),
              };
            } else {
              firstTurnDone = true;
              pendingWait = null;
              outcome = toCompletionOutcome(result.response);
            }
            // The turn's end is journaled before it is returned, so a reply lost with the process is
            // recovered as this outcome and never as a rerun.
            if (attempt && outcome.kind !== 'failed')
              await attempt.turnEnd({
                kind: 'turn-end',
                attemptId: turn.attemptId,
                phase,
                outcome,
                checkpoint: await participantSession.checkpoint!(),
              });
            // The default in-process journal never freed a settled execution's records (full
            // message arrays included) — safe exactly here, because nothing reads them back once
            // this turn settled with no wait parked; a journal a host supplied is left alone,
            // since its lifecycle is the host's to manage.
            if (usingDefaultJournal && !pendingWait) clearInProcessJournal(state.sessionId);
            return outcome;
          } catch (error) {
            if (signal.aborted) throw signal.reason ?? error;
            throw error;
          } finally {
            currentSink = undefined;
            // Whatever the turn did, nothing of this attempt may write once it has settled.
            if (attempt) {
              attempt.seal();
              writable.delete(attempt);
            }
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
            const attempt = attemptFor(turn, execOptions.signal);
            // Recovery restores a parked execution with no request: it is this attempt's own journal,
            // continued where it stopped, and the turn's input is not submitted again.
            const recovered = attempt && pendingWait?.requestIds.length === 0 ? pendingWait : null;
            if (recovered)
              return settle(turn, 'run', attempt, execOptions, (meteredJournal) =>
                session.resumeRecoverable({
                  executionId: recovered.executionId,
                  journal: meteredJournal,
                  toolResponses: [],
                  signal: execOptions.signal,
                }),
              );
            const text = render(turn, { firstTurn: !firstTurnDone });
            return settle(turn, 'run', attempt, execOptions, (meteredJournal) =>
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
            const attempt = attemptFor(turn, execOptions.signal);
            const toolResponses: {
              requestId: string;
              responseId: string;
              response: { approved: boolean };
            }[] = [];
            const reconciled: EffectSettlement[] = [];
            for (const entry of responses) {
              const { request, response } = entry;
              const belongs =
                request.turnId === turn.turnId &&
                request.participantId === turn.participantId &&
                parked.requestIds.includes(request.id);
              if (belongs && request.kind === 'approval' && response.kind === 'approval')
                toolResponses.push({
                  requestId: request.id,
                  responseId: entry.responseId,
                  response: { approved: response.approved },
                });
              else if (
                belongs &&
                attempt &&
                request.kind === 'reconciliation' &&
                response.kind === 'reconciliation'
              )
                reconciled.push({
                  requestId: request.id,
                  request: request.data,
                  answer: response.data,
                });
              else
                throw new RuntimeParticipantError(
                  'identity-mismatch',
                  'Response does not match the parked wait',
                );
            }
            const reader = attempt ?? journal!;
            const priorRecords = await reader.read(parked.executionId);
            if (priorRecords.length === 0)
              throw new RuntimeParticipantError(
                'journal-missing',
                'No journal records were found for the parked execution',
              );
            // What the host reports about an effect that started without a result becomes that
            // effect's journaled result, so the run continues from it and never starts the effect again.
            for (const settlement of reconciled)
              await settleReconciledEffect(attempt!, parked.executionId, settlement);
            return settle(
              turn,
              `wait:${parked.requestIds.join(',')}`,
              attempt,
              execOptions,
              (meteredJournal) =>
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
            releasePromise ??= (async () => {
              for (const attempt of writable) attempt.seal();
              writable.clear();
              try {
                if (usingDefaultJournal && !pendingWait) forgetInProcessJournal(state.sessionId);
                await session.shutdown();
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
