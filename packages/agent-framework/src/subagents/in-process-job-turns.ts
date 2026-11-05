/**
 * #3679 3f: the turns of an in-process job.
 *
 * A job a surface follows is steered with `send`: the prompt runs as the job's next turn, after the
 * turn in flight (a session runs one turn at a time), and the job ends only once every turn it
 * accepted has run. The decision that the job is over is made in the same synchronous step that finds
 * nothing queued, so a prompt is either accepted before it and run, or refused after it — never taken
 * and then lost, which is what a queue drained by one party and filled by another can otherwise do.
 */

import { BackgroundTaskError } from '@robota-sdk/agent-executor';

import type { Session } from '@robota-sdk/agent-session';

export interface IJobTurns {
  /** The last turn's output, once every accepted turn has run; rejects as the failing turn did. */
  readonly result: Promise<string>;
  /** Queues `prompt` as a later turn; refused once the job has ended. */
  send(prompt: string): Promise<void>;
  /** Whether the job has ended: it takes no more input and shows no more of its conversation. */
  readonly ended: boolean;
  /** Ends the job now: what was queued is dropped, and what comes after is refused. */
  end(): void;
}

/** Runs `firstPrompt` now, then each prompt sent meanwhile, one turn at a time. */
export function runJobTurns(
  session: Pick<Session, 'run'>,
  firstPrompt: string,
  jobId: string,
): IJobTurns {
  const queue: string[] = [];
  let ended = false;
  const result = (async (): Promise<string> => {
    try {
      let output = '';
      let failure: { error: unknown } | undefined;
      let prompt: string | undefined = firstPrompt;
      while (prompt !== undefined) {
        try {
          output = await session.run(prompt);
        } catch (error) {
          failure ??= { error };
        }
        prompt = ended ? undefined : queue.shift();
      }
      if (failure) throw failure.error;
      return output;
    } finally {
      // The check that found nothing queued and this assignment are one step: no send runs between.
      ended = true;
      queue.length = 0;
    }
  })();
  return {
    result,
    send: async (prompt) => {
      if (ended) {
        throw new BackgroundTaskError(
          'runner',
          `The job ${jobId} has ended; it takes no more input.`,
        );
      }
      queue.push(prompt);
    },
    get ended() {
      return ended;
    },
    end: () => {
      ended = true;
      queue.length = 0;
    },
  };
}
