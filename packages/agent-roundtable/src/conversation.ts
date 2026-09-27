import { ConversationPersistence } from './conversation-persistence';
import { abortableWait } from './abortable-wait';
import type { ConversationState, StoredMember, TerminalResult } from './conversation-state';
import { errorMessage, RoundtableError } from './errors';
import { executeGroup } from './group';
import {
  acceptMemberResponse,
  inputFingerprint,
  memberResponses,
  parkMember,
  publishMemberInputs,
  recordResponse,
  responseFingerprint,
  validateInput,
  validateResponse,
} from './conversation-requests';
import { MemoryConversationStore } from './memory-store';
import { roundRobin } from './policies';
import { resolveSelection, validateSelection } from './selection';
import type { StoreOwner } from './store-owner';
import type {
  AgentParticipant,
  ConversationSnapshot,
  ExternalInput,
  ParticipantDefinition,
  ParticipantLease,
  ParticipantTurn,
  Roundtable,
  RoundtableEvent,
  RoundtableOptions,
  RunResult,
  Selection,
  TurnSelector,
  ResumeRequest,
  ResponseReceipt,
} from './types';

export class Conversation implements Roundtable {
  private readonly participants: Map<string, ParticipantDefinition>;
  private readonly sessions = new Map<string, Promise<ParticipantLease>>();
  private readonly selector: TurnSelector;
  private readonly persistence: ConversationPersistence;
  private readonly concurrency: number;
  private active?: Promise<unknown>;
  private abort?: AbortController;
  private disposing?: Promise<void>;
  private disposed = false;
  private busy = false;
  private terminal?: TerminalResult;
  private readonly options: RoundtableOptions;

  constructor(options: RoundtableOptions, restored?: ConversationState) {
    this.options = {
      ...options,
      limits: { ...options.limits },
      participants: options.participants.map((p) =>
        p.kind === 'agent' ? { ...p, runtime: { ...p.runtime } } : { ...p },
      ),
    };
    this.concurrency = options.maxConcurrentParticipants ?? 1;
    this.validate();
    this.participants = new Map(this.options.participants.map((p) => [p.id, p]));
    this.selector = options.selector ?? roundRobin();
    this.persistence = new ConversationPersistence(
      options.store ?? new MemoryConversationStore(),
      restored ?? {
        schemaVersion: 1,
        definition: {
          purpose: options.purpose ?? null,
          limits: {
            maxTurnsPerRun: options.limits.maxTurnsPerRun,
            timeoutMs: options.limits.timeoutMs ?? null,
          },
          maxConcurrentParticipants: this.concurrency,
          recovery: options.recovery ?? 'none',
          leaseMs: options.leaseMs ?? 30_000,
          selector: this.selector.reference ?? null,
          contextPolicy: { id: 'roundtable/increments', version: '1' },
        },
        selectorCheckpoint: null,
        snapshot: {
          conversationId: options.conversationId,
          revision: 0,
          messages: [],
          turns: [],
          requests: [],
        },
        participants: this.options.participants.map((p) => ({
          id: p.id,
          description: p.description ?? null,
          runtime: p.kind === 'agent' ? p.runtime : null,
          checkpoint: null,
          delivered: [],
        })),
        inputs: [],
        responses: [],
        phase: { kind: 'ready' },
        terminal: null,
      },
      options.leaseMs ?? 30_000,
      restored !== undefined,
    );
    this.terminal = restored?.terminal ?? undefined;
  }

  snapshot(): ConversationSnapshot {
    return this.persistence.snapshot().snapshot;
  }

  run(options: { signal?: AbortSignal } = {}): Promise<RunResult> {
    try {
      this.assertIdle();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.terminal) return Promise.resolve(structuredClone(this.terminal));
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (this.options.limits.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, this.options.limits.timeoutMs);
    }
    const running = this.executeOwned(signal, () => timedOut).finally(() => {
      clearTimeout(timeout);
      this.active = undefined;
      this.abort = undefined;
      this.busy = false;
    });
    this.active = running;
    return running;
  }

  submitInput(value: ExternalInput): Promise<{ revision: number; messageId: string }> {
    let input: ExternalInput;
    try {
      input = structuredClone(value);
      validateInput(input);
      if (this.disposed) throw new RoundtableError('disposed', 'Conversation has been disposed');
      const previous = this.persistence
        .snapshot()
        .inputs.find((receipt) => receipt.id === input.inputId);
      if (previous) {
        if (previous.fingerprint !== inputFingerprint(input))
          throw new RoundtableError('conflict', 'Input id was used with different content');
        return Promise.resolve(previous.result);
      }
      this.assertIdle();
      if (this.terminal) throw new RoundtableError('conflict', 'Conversation has terminated');
      if (this.persistence.snapshot().phase.kind !== 'ready') {
        const request = this.snapshot().requests.find(
          (pending) => pending.id === input.replyToRequestId,
        );
        if (
          request?.kind === 'input' &&
          request.memberId &&
          request.participantId === input.participantId
        ) {
          return this.resume({
            requestId: request.id,
            responseId: input.inputId,
            expectedRevision: input.expectedRevision,
            response: { kind: 'input', content: input.content },
          }).then(() => {
            const receipt = this.persistence
              .snapshot()
              .inputs.find((saved) => saved.id === input.inputId);
            if (!receipt)
              throw new RoundtableError('conflict', 'Input response receipt is missing');
            return receipt.result;
          });
        }
        throw new RoundtableError(
          'conflict',
          'Resolve the saved execution before submitting new input',
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }
    this.busy = true;
    const submitted = this.acceptInput(input).finally(() => {
      this.busy = false;
      this.active = undefined;
    });
    this.active = submitted;
    return submitted;
  }

  resume(value: ResumeRequest): Promise<ResponseReceipt> {
    let input: ResumeRequest;
    try {
      input = structuredClone(value);
      validateResponse(input);
      if (this.disposed) throw new RoundtableError('disposed', 'Conversation has been disposed');
      const previous = this.persistence
        .snapshot()
        .responses.find((entry) => entry.value.responseId === input.responseId);
      if (previous) {
        if (previous.fingerprint !== responseFingerprint(input))
          throw new RoundtableError('conflict', 'Response id was used with different content');
        return Promise.resolve(previous.result);
      }
      this.assertIdle();
      if (this.terminal) throw new RoundtableError('conflict', 'Conversation has terminated');
      const request = this.snapshot().requests.find((pending) => pending.id === input.requestId);
      if (!request) throw new RoundtableError('conflict', 'Request is absent or already consumed');
      if (request.kind !== input.response.kind)
        throw new RoundtableError('conflict', 'Response kind differs from its request');
      if (request.kind === 'input' && !request.memberId && input.response.kind === 'input') {
        return this.submitInput({
          participantId: request.participantId,
          inputId: input.responseId,
          expectedRevision: input.expectedRevision,
          replyToRequestId: request.id,
          content: input.response.content,
        }).then(() => {
          const receipt = this.persistence
            .snapshot()
            .responses.find((entry) => entry.value.responseId === input.responseId);
          if (!receipt) throw new RoundtableError('conflict', 'Input response receipt is missing');
          return receipt.result;
        });
      }
    } catch (error) {
      return Promise.reject(error);
    }
    this.busy = true;
    const submitted = this.acceptResponse(input).finally(() => {
      this.busy = false;
      this.active = undefined;
    });
    this.active = submitted;
    return submitted;
  }

  private async acceptResponse(input: ResumeRequest): Promise<ResponseReceipt> {
    await this.persistence.begin();
    try {
      await this.persistence.update((draft, revision) => {
        acceptMemberResponse(draft, input, revision);
      });
      return this.persistence
        .snapshot()
        .responses.find((entry) => entry.value.responseId === input.responseId)!.result;
    } finally {
      await this.persistence.end();
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.abort?.abort();
    this.disposing = (async () => {
      await this.active?.catch(() => {});
      const releases = await Promise.allSettled(
        [...this.sessions.values()].map(async (opened) => {
          const lease = await opened.catch(() => undefined);
          if (lease) await lease.release();
        }),
      );
      const errors = releases.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
      if (errors.length) throw new AggregateError(errors, 'Participant release failed');
    })();
    return this.disposing;
  }

  private async executeOwned(signal: AbortSignal, timedOut: () => boolean): Promise<RunResult> {
    const owner = await this.persistence.begin();
    try {
      return await this.execute(AbortSignal.any([signal, owner.signal]), owner);
    } catch (error) {
      // A turn stored as running was never seen to settle (the process stopped mid-turn), so it is
      // neither rerun nor finished until the host reconciles it.
      if (error instanceof RoundtableError && error.code === 'recovery-required') throw error;
      // A member failure that settled before cancellation stays final.
      const { phase } = this.persistence.snapshot();
      const memberFailed =
        phase.kind === 'group' && phase.members.some((member) => member.status === 'failed');
      if (signal.aborted && !memberFailed) return await this.stop(owner, timedOut());
      return await this.fail(owner, error);
    } finally {
      await this.persistence.end();
    }
  }

  /** Cancellation, disposal and time limits end this run at a safe point, never the conversation. */
  private async stop(owner: StoreOwner, timedOut: boolean): Promise<RunResult> {
    if (!owner.signal.aborted && this.persistence.snapshot().phase.kind === 'selecting') {
      // The selector call settled without a saved decision, so the next run asks again. If this
      // write fails, the stored attempt stays and loading requires reconciliation.
      await this.persistence
        .update((draft) => {
          draft.phase = { kind: 'ready' };
        })
        .catch(() => {});
    }
    const revision = this.snapshot().revision;
    return timedOut
      ? { status: 'limited', reason: 'time', revision }
      : { status: 'cancelled', revision };
  }

  private async fail(owner: StoreOwner, error: unknown): Promise<RunResult> {
    let result: TerminalResult = {
      status: 'failed',
      revision: this.snapshot().revision,
      message: errorMessage(error),
    };
    if (!owner.signal.aborted) {
      try {
        await this.persistence.update((draft, revision) => {
          draft.terminal = { ...result, revision };
        });
        result = { ...result, revision: this.snapshot().revision };
      } catch (persistError) {
        result = {
          status: 'failed',
          revision: this.snapshot().revision,
          message: `Could not save execution failure: ${errorMessage(persistError)}`,
        };
      }
    }
    this.terminal = result;
    return structuredClone(result);
  }

  private async execute(signal: AbortSignal, owner: StoreOwner): Promise<RunResult> {
    let attempted = 0;
    for (;;) {
      signal.throwIfAborted();
      let view = this.snapshot();
      const phase = this.persistence.snapshot().phase;
      if (phase.kind === 'group') {
        attempted += phase.members.filter(
          (member) => member.status === 'pending' || member.status === 'resumable',
        ).length;
        await this.continueGroup(signal, owner);
        view = this.snapshot();
        if (view.requests.length)
          return { status: 'waiting', revision: view.revision, requests: view.requests };
        continue;
      }
      if (view.requests.length)
        return { status: 'waiting', revision: view.revision, requests: view.requests };
      if (attempted >= this.options.limits.maxTurnsPerRun)
        return { status: 'limited', reason: 'turns', revision: view.revision };
      let selection: Selection;
      if (phase.kind === 'selected') selection = phase.selection;
      else {
        const attemptId = crypto.randomUUID();
        await this.persistence.update((draft) => {
          draft.phase = { kind: 'selecting', attemptId };
        });
        await owner.admit();
        signal.throwIfAborted();
        view = this.snapshot();
        const decision = await this.selector.select(
          {
            participants: [...this.participants.values()].map(({ id, kind, description }) => ({
              id,
              kind,
              description,
            })),
            messages: view.messages,
            turns: view.turns,
            remainingTurns: this.options.limits.maxTurnsPerRun - attempted,
          },
          { signal },
        );
        selection = validateSelection(
          decision,
          this.participants,
          this.options.limits.maxTurnsPerRun,
        );
        const checkpoint = (await this.selector.checkpoint?.()) ?? null;
        await this.persistence.update((draft) => {
          draft.selectorCheckpoint = checkpoint;
          draft.phase = { kind: 'selected', attemptId, selection };
        });
      }
      signal.throwIfAborted();
      if (selection.kind === 'finish') {
        await this.persistence.update((draft, revision) => {
          draft.phase = { kind: 'ready' };
          draft.terminal = { status: 'completed', reason: selection.reason, revision };
        });
        this.terminal = {
          status: 'completed',
          reason: selection.reason,
          revision: this.snapshot().revision,
        };
        return structuredClone(this.terminal);
      }
      const selected = resolveSelection(selection, this.participants);
      if (selected.length > this.options.limits.maxTurnsPerRun - attempted) {
        return { status: 'limited', reason: 'turns', revision: this.snapshot().revision };
      }
      const groupId = crypto.randomUUID();
      if (selected[0].kind === 'external') {
        await this.persistence.update((draft) => {
          draft.snapshot.requests.push({
            id: crypto.randomUUID(),
            kind: 'input',
            participantId: selected[0].id,
            reason: selection.kind === 'wait' ? selection.reason : 'Participant input requested',
            groupId,
            turnId: crypto.randomUUID(),
          });
          draft.phase = { kind: 'ready' };
        });
        continue;
      }
      attempted += selected.length;
      const agents = selected.filter((p): p is AgentParticipant => p.kind === 'agent');
      await this.executeParticipants(agents, groupId, signal, owner);
    }
  }

  private async executeParticipants(
    selected: AgentParticipant[],
    groupId: string,
    signal: AbortSignal,
    owner: StoreOwner,
  ): Promise<void> {
    const state = this.persistence.snapshot();
    const baseRevision = state.snapshot.revision;
    const turns: ParticipantTurn[] = selected.map((p) => ({
      conversationId: this.options.conversationId,
      participantId: p.id,
      groupId,
      turnId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      ...(this.options.purpose === undefined ? {} : { purpose: this.options.purpose }),
      context: {
        baseRevision,
        messages: state.snapshot.messages.filter(
          (m) =>
            m.participantId !== p.id &&
            !state.participants.find((stored) => stored.id === p.id)?.delivered.includes(m.id),
        ),
      },
    }));
    await this.persistence.update((draft) => {
      draft.phase = {
        kind: 'group',
        groupId,
        baseRevision,
        members: turns.map((turn) => ({
          participantId: turn.participantId,
          turn,
          messageId: crypto.randomUUID(),
          status: 'pending',
          requestIds: [],
          checkpoint: null,
          outcome: null,
          error: null,
        })),
      };
    });
    await this.emit(
      { type: 'group-started', groupId, participantIds: selected.map((p) => p.id), baseRevision },
      signal,
    );
    await this.continueGroup(signal, owner);
  }

  private async continueGroup(signal: AbortSignal, owner: StoreOwner): Promise<void> {
    const phase = this.persistence.snapshot().phase;
    if (phase.kind !== 'group') throw new RoundtableError('conflict', 'Active group is missing');
    if (
      phase.members.some(
        (member) => !['pending', 'prepared', 'waiting', 'resumable'].includes(member.status),
      )
    ) {
      throw new RoundtableError(
        'recovery-required',
        'Unsettled execution requires runtime reconciliation',
      );
    }
    const pending = phase.members.filter(
      (member) => member.status === 'pending' || member.status === 'resumable',
    );
    const resumeState = this.persistence.snapshot();
    const selected = pending.map((member) => this.participants.get(member.participantId));
    if (selected.some((participant) => participant?.kind !== 'agent'))
      throw new RoundtableError('conflict', 'Group participant is missing');
    await executeGroup({
      participants: selected as AgentParticipant[],
      turns: pending.map((member) => member.turn),
      concurrency: this.concurrency,
      signal,
      session: (p) => this.session(p),
      emit: (event, eventSignal) => this.emit(event, eventSignal),
      admit: () => owner.admit(),
      responses: (turn) => {
        const member = pending.find((candidate) => candidate.turn.turnId === turn.turnId)!;
        return member.status === 'resumable' ? memberResponses(resumeState, member) : undefined;
      },
      start: (turn) =>
        this.persistence.update((draft) => {
          this.member(draft, turn).status = 'running';
        }),
      restore: (turn) =>
        this.persistence.update((draft) => {
          const member = this.member(draft, turn);
          // A result prepared or parked before the abort was settled work; keep it.
          if (member.status === 'prepared' || member.status === 'waiting') return;
          const saved = pending.find((candidate) => candidate.turn.turnId === turn.turnId)!;
          Object.assign(member, structuredClone(saved), {
            turn: { ...saved.turn, attemptId: crypto.randomUUID() },
          });
        }),
      settle: (turn, outcome) =>
        this.persistence.update((draft) => {
          Object.assign(this.member(draft, turn), { status: 'settled', outcome });
        }),
      prepare: ({ turn, outcome, checkpoint }) =>
        this.persistence.update((draft) => {
          const member = this.member(draft, turn);
          if (outcome.kind === 'wait') parkMember(draft, member, outcome.requests, checkpoint);
          else Object.assign(member, { status: 'prepared', outcome, checkpoint, requestIds: [] });
        }),
      fail: (turn, error) =>
        this.persistence.update((draft) => {
          const member = this.member(draft, turn);
          if (member.status !== 'prepared' && member.status !== 'waiting') {
            member.status = 'failed';
            member.error = errorMessage(error);
          }
        }),
    });
    signal.throwIfAborted();
    if (this.snapshot().requests.length) return;
    await this.persistence.update((draft, revision) => {
      if (draft.phase.kind !== 'group')
        throw new RoundtableError('conflict', 'Active group changed');
      for (const member of draft.phase.members) {
        const { turn, outcome } = member;
        if (member.status !== 'prepared' || !outcome || outcome.kind === 'wait')
          throw new RoundtableError('conflict', 'Group is not prepared');
        const inputIds = publishMemberInputs(draft, member, revision);
        if (outcome.kind === 'speak')
          draft.snapshot.messages.push({
            id: member.messageId,
            participantId: member.participantId,
            content: outcome.content,
            revision,
            turnId: turn.turnId,
            groupId: phase.groupId,
          });
        const participant = draft.participants.find((p) => p.id === member.participantId);
        if (!participant) throw new RoundtableError('conflict', 'Participant state is missing');
        participant.checkpoint = member.checkpoint;
        participant.delivered.push(...turn.context.messages.map((m) => m.id), ...inputIds);
        draft.snapshot.turns.push({
          id: turn.turnId,
          groupId: phase.groupId,
          participantId: member.participantId,
          outcome: outcome.kind,
        });
      }
      draft.phase = { kind: 'ready' };
    });
    await this.emit(
      {
        type: 'published',
        groupId: phase.groupId,
        messages: this.snapshot().messages.filter((m) => m.groupId === phase.groupId),
      },
      signal,
    );
  }

  private async acceptInput(
    input: ExternalInput,
  ): Promise<{ revision: number; messageId: string }> {
    await this.persistence.begin();
    try {
      if (!input.inputId || typeof input.content !== 'string')
        throw new RoundtableError('conflict', 'Input id and text are required');
      if (this.participants.get(input.participantId)?.kind !== 'external')
        throw new RoundtableError(
          'conflict',
          'Input must belong to a registered external participant',
        );
      const fingerprint = inputFingerprint(input);
      const messageId = crypto.randomUUID();
      await this.persistence.update((draft, revision) => {
        if (input.expectedRevision !== draft.snapshot.revision)
          throw new RoundtableError('conflict', 'Conversation revision changed');
        const request = draft.snapshot.requests.find((r) => r.id === input.replyToRequestId);
        if (
          (draft.snapshot.requests.length > 0 || input.replyToRequestId) &&
          request?.participantId !== input.participantId
        ) {
          throw new RoundtableError('conflict', 'Input does not satisfy the pending request');
        }
        const groupId = request?.groupId ?? crypto.randomUUID();
        const turnId = request?.turnId ?? crypto.randomUUID();
        draft.snapshot.messages.push({
          id: messageId,
          participantId: input.participantId,
          content: input.content,
          revision,
          turnId,
          groupId,
        });
        if (request) {
          draft.snapshot.requests = draft.snapshot.requests.filter((r) => r.id !== request.id);
          draft.snapshot.turns.push({
            id: turnId,
            groupId,
            participantId: input.participantId,
            outcome: 'speak',
          });
        }
        if (request) {
          recordResponse(
            draft,
            request,
            {
              requestId: request.id,
              responseId: input.inputId,
              expectedRevision: input.expectedRevision,
              response: { kind: 'input', content: input.content },
            },
            revision,
            { messageId, turnId },
          );
        } else {
          if (draft.responses.some((entry) => entry.value.responseId === input.inputId))
            throw new RoundtableError('conflict', 'Input id was already used for a response');
          draft.inputs.push({ id: input.inputId, fingerprint, result: { revision, messageId } });
        }
      });
      return { revision: this.snapshot().revision, messageId };
    } finally {
      await this.persistence.end();
    }
  }

  private member(state: ConversationState, turn: ParticipantTurn): StoredMember {
    const member =
      state.phase.kind === 'group'
        ? state.phase.members.find((m) => m.turn.turnId === turn.turnId)
        : undefined;
    if (!member) throw new RoundtableError('conflict', 'Participant execution is no longer active');
    return member;
  }

  private session(participant: AgentParticipant): Promise<ParticipantLease> {
    let opened = this.sessions.get(participant.id);
    if (!opened) {
      const state = this.persistence.snapshot();
      const member =
        state.phase.kind === 'group'
          ? state.phase.members.find((candidate) => candidate.participantId === participant.id)
          : undefined;
      const checkpoint = member?.requestIds.length
        ? member.checkpoint
        : state.participants.find((p) => p.id === participant.id)?.checkpoint;
      opened = participant.factory.openSession({
        conversationId: this.options.conversationId,
        participantId: participant.id,
        ...(checkpoint ? { checkpoint } : {}),
      });
      this.sessions.set(participant.id, opened);
    }
    return opened;
  }

  private async emit(event: RoundtableEvent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    try {
      await abortableWait(this.options.onEvent?.(event), signal);
    } catch (error) {
      signal.throwIfAborted();
      // Observers cannot roll back a committed group or act as its persistence barrier.
      try {
        await abortableWait(this.options.onEventError?.(error, event), signal);
      } catch {
        signal.throwIfAborted();
      }
    }
  }

  private assertIdle(): void {
    if (this.disposed) throw new RoundtableError('disposed', 'Conversation has been disposed');
    if (this.busy)
      throw new RoundtableError('busy', 'Conversation already has an active scheduler');
  }

  private validate(): void {
    const ids = this.options.participants.map((p) => p.id);
    if (
      !this.options.conversationId ||
      !ids.length ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    ) {
      throw new RoundtableError(
        'invalid-config',
        'Conversation and unique participant ids are required',
      );
    }
    if (this.options.recovery === 'durable')
      throw new RoundtableError(
        'invalid-config',
        'Durable execution requires runtime recovery support',
      );
    for (const value of [
      this.concurrency,
      this.options.limits.maxTurnsPerRun,
      this.options.limits.timeoutMs ?? 1,
      this.options.leaseMs ?? 30_000,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new RoundtableError(
          'invalid-config',
          'Execution limits must be positive safe integers',
        );
    }
  }
}
