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

import { SessionExecutionController } from '../interactive-session-execution-controller.js';
import type { IQueuedInput } from '../interactive-session-execution-controller.js';
import { TurnNotRunError } from '@robota-sdk/agent-interface-transport';

function createController(): SessionExecutionController {
  return new SessionExecutionController(
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
  const { turnId } = controller.beginSubmission();
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
  const deadline = new Promise<string>((resolve) => setTimeout(() => resolve('never settled'), 250));
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
    const first = controller.beginSubmission();
    controller.enqueuePending({ input: 'first', options: { driverId: 'owner' }, turnId: first.turnId });

    // Same driver, so the queue REPLACES the tail rather than appending — the standard
    // editable-pending behaviour. The replaced entry is now unreachable.
    controller.enqueuePending(queued(controller, 'owner'));

    expect(await reasonOf(first.completed)).toBe('coalesced');
  });

  it('says `dropped` when the queue is at capacity', async () => {
    const controller = createController();
    // Distinct drivers, so each APPENDS instead of coalescing, which is what fills the queue.
    for (let i = 0; i < 32; i++) controller.enqueuePending(queued(controller, `driver-${i}`));

    const overflow = controller.beginSubmission();
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
    const waiting = controller.beginSubmission();
    controller.enqueuePending({ input: 'waiting', options: { driverId: 'owner' }, turnId: waiting.turnId });

    controller.clearPendingQueue();

    expect(await reasonOf(waiting.completed)).toBe('cancelled');
  });

  it('hands the queued submission back the SAME promise when its turn finally starts', () => {
    // The drain re-enters `submit` for an input accepted earlier, and its caller is holding the
    // promise from that acceptance. Minting a second one there would settle something nobody is
    // waiting on — the hang this whole type exists to prevent, reintroduced at the last step.
    const controller = createController();
    const accepted = controller.beginSubmission();

    expect(controller.completionOf(accepted.turnId)).toBe(accepted.completed);
  });
});
