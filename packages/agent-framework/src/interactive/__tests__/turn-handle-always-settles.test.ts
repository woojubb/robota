/**
 * RUNTIME-003 — `ITurnHandle.completed` always settles.
 *
 * The handle is only useful if waiting on it is safe, and the dangerous cases are the ones where the
 * submission is ACCEPTED and then never runs. A session runs one turn at a time and queues the rest,
 * and the co-drive queue does not promise every entry a turn: a same-driver input coalesces into the
 * one behind it, an input arriving at capacity is dropped, and clearing the queue discards whatever
 * is in it. Each of those used to be invisible — `submit` returned nothing, so there was no one to
 * tell. A caller holding a handle for one of them would wait forever, which is worse than the
 * ambiguity the handle exists to remove.
 *
 * These cases work directly against the execution controller rather than a whole session, because
 * the queue is what decides these outcomes and driving a real model turn to reach it would be a
 * slower test of something else.
 */

import { describe, expect, it, vi } from 'vitest';

import { createSessionStub } from './helpers/session-stub.js';
import { acceptSubmission } from '../interactive-session-accept-submission.js';
import { InteractiveSession } from '../interactive-session.js';
import { SessionExecutionController } from '../interactive-session-execution-controller.js';
import type { IQueuedInput } from '../interactive-session-execution-controller.js';
import { TurnNotRunError } from '../turn-not-run-error.js';

/** Exposes the protected drain so a case can reach the resubmission path directly. */
class DrainableController extends SessionExecutionController {
  drainNow(submit: Parameters<DrainableController['drainPendingQueue']>[0]): void {
    this.drainPendingQueue(submit);
  }
}

function createController(): DrainableController {
  return new DrainableController(
    {} as never,
    {} as never,
    {
      emit: vi.fn(),
      getContextState: vi.fn(),
      getCwd: () => process.cwd(),
      getSessionOrThrow: vi.fn(),
      persistSession: vi.fn(),
    } as never,
  );
}

function queued(controller: SessionExecutionController, driverId: string): IQueuedInput {
  const { turnId } = controller.turns.begin();
  return { input: `from ${driverId}`, options: { driverId }, turnId };
}

/**
 * The reason the handle settled with, or `never settled` if it did not settle at all.
 *
 * The deadline is the point. A handle that never settles fails these cases by HANGING, and a case
 * that dies on the suite timeout reports "timed out" — true, but it names the harness rather than
 * the defect. Racing a short deadline turns the hang into an assertion that says what went wrong.
 */
async function reasonOf(completed: Promise<unknown>): Promise<string> {
  const deadline = new Promise<string>((resolve) =>
    setTimeout(() => resolve('never settled'), 250),
  );
  return Promise.race([
    completed.then(
      () => 'settled — the submission was not refused a turn',
      (error: unknown) =>
        error instanceof TurnNotRunError ? error.reason : `unexpected: ${String(error)}`,
    ),
    deadline,
  ]);
}

describe('RUNTIME-003: a submission that never runs still answers its caller', () => {
  it('says `coalesced` when a later input from the same driver replaces it', async () => {
    const controller = createController();
    const first = controller.turns.begin();
    controller.enqueuePending({
      input: 'first',
      options: { driverId: 'owner' },
      turnId: first.turnId,
    });

    // Same driver, so the queue REPLACES the tail rather than appending — the standard
    // editable-pending behaviour. The replaced entry is now unreachable.
    controller.enqueuePending(queued(controller, 'owner'));

    expect(await reasonOf(first.completed)).toBe('coalesced');
  });

  it('says `dropped` when the queue is at capacity', async () => {
    const controller = createController();
    // Distinct drivers, so each APPENDS instead of coalescing, which is what fills the queue.
    for (let i = 0; i < 32; i++) controller.enqueuePending(queued(controller, `driver-${i}`));

    const overflow = controller.turns.begin();
    const outcome = controller.enqueuePending({
      input: 'one too many',
      options: { driverId: 'driver-late' },
      turnId: overflow.turnId,
    });

    expect(outcome, 'the queue accepted an entry past its own cap').toBe('dropped');
    expect(await reasonOf(overflow.completed)).toBe('dropped');
  });

  it('says `cancelled` when the queue is cleared out from under it', async () => {
    const controller = createController();
    const waiting = controller.turns.begin();
    controller.enqueuePending({
      input: 'waiting',
      options: { driverId: 'owner' },
      turnId: waiting.turnId,
    });

    controller.clearPendingQueue();

    expect(await reasonOf(waiting.completed)).toBe('cancelled');
  });
});

describe('RUNTIME-003: the identity survives the whole queued path', () => {
  // Review found the gap that once made the queued half inert: the entry `submit()` built had no
  // top-level identity. The cases above build entries directly, so this group also proves the real
  // public acceptance wiring carries its required id and rejects forged resume authority.
  //
  // `execCtrl` is protected, and a case that cast that away would be breaking encapsulation to look
  // at something. A subclass is what the modifier permits, so the observation costs nothing the
  // design did not already allow.
  class ObservableSession extends InteractiveSession {
    readonly enqueued: IQueuedInput[] = [];

    watchTheQueue(): void {
      this.execCtrl.executing = true; // a turn is in flight, so the next submission queues
      const enqueue = this.execCtrl.enqueuePending.bind(this.execCtrl);
      this.execCtrl.enqueuePending = (entry: IQueuedInput) => {
        this.enqueued.push(entry);
        return enqueue(entry);
      };
    }
  }

  it('settles a resubmission that THROWS on its way back in', async () => {
    // `drainPendingQueue` shifts the head out of `pending` before the timer fires, so nothing else
    // can settle it — and `submit` throws SYNCHRONOUSLY at the top of `interactive-session.ts` when
    // `shuttingDown` was set in the meantime. Review found that the caller's `completed` then never
    // settled at all, which is the one promise `ITurnHandle` makes.
    const controller = createController();
    const { turnId, completed } = controller.turns.begin();
    controller.enqueuePending({ input: 'queued', options: { driverId: 'owner' }, turnId });

    controller.executing = false;
    controller.drainNow(() => {
      throw new Error('session is shutting down');
    });

    // Raced against a deadline for the reason this file already gives above: without the fix this
    // case fails by HANGING, and a suite timeout reports "timed out" — true, but it names the
    // harness instead of the defect. RAN against the unguarded resubmission: it hung.
    const outcome = await Promise.race([
      completed.then(
        () => 'settled — the resubmission did not throw',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('never settled'), 250)),
    ]);

    expect(outcome).toMatch(/shutting down/);
  });

  it('hands queue ownership to the next turn before a new public submission can enter', async () => {
    const controller = createController();
    const first = controller.turns.begin();
    const second = controller.turns.begin();
    controller.enqueuePending({ input: 'B', options: { driverId: 'B' }, turnId: first.turnId });
    controller.enqueuePending({ input: 'C', options: { driverId: 'C' }, turnId: second.turnId });
    const order: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const resume = async (entry: IQueuedInput): Promise<void> => {
      controller.executing = true;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      order.push(entry.input);
      await Promise.resolve();
      concurrent -= 1;
      controller.executing = false;
      controller.turns.settle(entry.turnId, { content: entry.input } as never);
      controller.drainNow(resume);
    };

    controller.executing = false;
    controller.drainNow(resume);

    expect(controller.executing, 'queue handoff released execution ownership for one tick').toBe(
      true,
    );
    expect(order).toEqual(['B']);
    await first.completed;
    await second.completed;
    expect(order).toEqual(['B', 'C']);
    expect(maxConcurrent).toBe(1);
  });

  it('what submit() enqueues carries the id it minted', async () => {
    const session = new ObservableSession({ session: createSessionStub() });
    session.watchTheQueue();

    const handle = await session.submit('queued behind a running turn');

    expect(session.enqueued).toHaveLength(1);
    expect(
      session.enqueued[0]?.turnId,
      'the queue entry has no identity, so no refusal can settle its handle',
    ).toBe(handle.turnId);
  });

  it('ignores a forged resume identity at the exported concrete submit boundary', async () => {
    const session = new ObservableSession({ session: createSessionStub() });
    session.watchTheQueue();
    const forgedTurnId = 'caller-selected-existing-turn';

    const handle = await Reflect.apply(session.submit, session, [
      'queued behind a running turn',
      undefined,
      undefined,
      { driverId: 'owner', resumeTurnId: forgedTurnId },
    ]);

    expect(handle.turnId).not.toBe(forgedTurnId);
    expect(session.enqueued[0]?.turnId).toBe(handle.turnId);
  });
});

describe('RUNTIME-006: turn identity is required only on internal accepted-turn paths', () => {
  it('mints identity even when an untyped caller forges the removed resume option', () => {
    const controller = createController();
    const forgedTurnId = 'caller-selected-existing-turn';
    const accepted = acceptSubmission({ resumeTurnId: forgedTurnId } as never, controller);
    void accepted.completed.catch(() => undefined);

    expect(accepted.turnId).not.toBe(forgedTurnId);
  });

  it('keeps resume authority out of public options and requires identity downstream', () => {
    type PublicSubmitOptions = NonNullable<Parameters<InteractiveSession['submit']>[3]>;
    const publicOptions: PublicSubmitOptions = { driverId: 'owner' };

    // @ts-expect-error RUNTIME-006: callers cannot express queued-turn resume authority.
    const forgedPublicOptions: PublicSubmitOptions = { resumeTurnId: 'forged' };
    // @ts-expect-error RUNTIME-006: every queued entry has already been assigned an identity.
    const missingQueueIdentity: IQueuedInput = { input: 'missing id', options: {} };

    const turns = new SessionExecutionController(
      {} as never,
      {} as never,
      { emit: vi.fn() } as never,
    ).turns;
    // @ts-expect-error RUNTIME-006: settlement cannot silently ignore a missing identity.
    turns.settle(undefined, {} as never);
    // @ts-expect-error RUNTIME-006: failure cannot silently ignore a missing identity.
    turns.fail(undefined, new Error('missing identity'));
    // @ts-expect-error RUNTIME-006: refusal cannot silently ignore a missing identity.
    turns.refuse(undefined, 'cancelled');

    expect(publicOptions.driverId).toBe('owner');
    expect((forgedPublicOptions as { resumeTurnId: string }).resumeTurnId).toBe('forged');
    expect(missingQueueIdentity.input).toBe('missing id');
  });
});
