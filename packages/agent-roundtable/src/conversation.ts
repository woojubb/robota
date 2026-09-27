import { ConversationPersistence } from './conversation-persistence';
import { abortableWait } from './abortable-wait';
import type { ConversationState, StoredMember } from './conversation-state';
import { errorMessage, RoundtableError } from './errors';
import { executeGroup } from './group';
import { MemoryConversationStore } from './memory-store';
import { roundRobin } from './policies';
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
  private terminal?: RunResult;
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

  submitInput(input: ExternalInput): Promise<{ revision: number; messageId: string }> {
    try {
      if (this.disposed) throw new RoundtableError('disposed', 'Conversation has been disposed');
      const previous = this.persistence
        .snapshot()
        .inputs.find((receipt) => receipt.id === input.inputId);
      if (previous) {
        if (previous.fingerprint !== this.inputFingerprint(input))
          throw new RoundtableError('conflict', 'Input id was used with different content');
        return Promise.resolve(previous.result);
      }
      this.assertIdle();
      if (this.terminal) throw new RoundtableError('conflict', 'Conversation has terminated');
      if (this.persistence.snapshot().phase.kind !== 'ready') {
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
      let result: RunResult = signal.aborted
        ? {
            revision: this.snapshot().revision,
            ...(timedOut()
              ? { status: 'limited' as const, reason: 'time' as const }
              : { status: 'cancelled' as const }),
          }
        : { status: 'failed', revision: this.snapshot().revision, message: errorMessage(error) };
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
    } finally {
      await this.persistence.end();
    }
  }

  private async execute(signal: AbortSignal, owner: StoreOwner): Promise<RunResult> {
    let attempted = 0;
    for (;;) {
      signal.throwIfAborted();
      let view = this.snapshot();
      if (view.requests.length)
        return { status: 'waiting', revision: view.revision, requests: view.requests };
      const phase = this.persistence.snapshot().phase;
      if (phase.kind === 'group') {
        attempted += phase.members.filter((member) => member.status === 'pending').length;
        await this.continueGroup(signal, owner);
        continue;
      }
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
        selection = await this.selector.select(
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
      const selected = this.resolveSelection(selection);
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
      phase.members.some((member) => member.status !== 'pending' && member.status !== 'prepared')
    ) {
      throw new RoundtableError(
        'recovery-required',
        'Unsettled execution requires runtime reconciliation',
      );
    }
    const pending = phase.members.filter((member) => member.status === 'pending');
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
      start: (turn) =>
        this.persistence.update((draft) => {
          this.member(draft, turn).status = 'running';
        }),
      settle: (turn, outcome) =>
        this.persistence.update((draft) => {
          Object.assign(this.member(draft, turn), { status: 'settled', outcome });
        }),
      prepare: ({ turn, outcome, checkpoint }) =>
        this.persistence.update((draft) => {
          Object.assign(this.member(draft, turn), { status: 'prepared', outcome, checkpoint });
        }),
      fail: (turn, error) =>
        this.persistence.update((draft) => {
          const member = this.member(draft, turn);
          if (member.status !== 'prepared') {
            member.status = 'failed';
            member.error = errorMessage(error);
          }
        }),
    });
    signal.throwIfAborted();
    await this.persistence.update((draft, revision) => {
      if (draft.phase.kind !== 'group')
        throw new RoundtableError('conflict', 'Active group changed');
      for (const member of draft.phase.members) {
        const { turn, outcome } = member;
        if (member.status !== 'prepared' || !outcome)
          throw new RoundtableError('conflict', 'Group is not prepared');
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
        participant.delivered.push(...turn.context.messages.map((m) => m.id));
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
      const fingerprint = this.inputFingerprint(input);
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
        draft.inputs.push({ id: input.inputId, fingerprint, result: { revision, messageId } });
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
      const checkpoint = this.persistence
        .snapshot()
        .participants.find((p) => p.id === participant.id)?.checkpoint;
      opened = participant.factory.openSession({
        conversationId: this.options.conversationId,
        participantId: participant.id,
        ...(checkpoint ? { checkpoint } : {}),
      });
      this.sessions.set(participant.id, opened);
    }
    return opened;
  }

  private resolveSelection(
    selection: Exclude<Selection, { kind: 'finish' }>,
  ): ParticipantDefinition[] {
    const ids =
      selection.kind === 'parallel' ? [...selection.participantIds] : [selection.participantId];
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new RoundtableError('invalid-selection', 'Selection requires unique participants');
    return ids.map((id) => {
      const participant = this.participants.get(id);
      if (!participant)
        throw new RoundtableError('invalid-selection', `Unknown participant: ${id}`);
      if (selection.kind === 'parallel' && participant.kind !== 'agent')
        throw new RoundtableError(
          'invalid-selection',
          'Parallel selection requires agent participants',
        );
      if (selection.kind === 'wait' && participant.kind !== 'external')
        throw new RoundtableError(
          'invalid-selection',
          'Input wait requires an external participant',
        );
      return participant;
    });
  }

  private inputFingerprint(input: ExternalInput): string {
    return JSON.stringify([input.participantId, input.replyToRequestId ?? null, input.content]);
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
