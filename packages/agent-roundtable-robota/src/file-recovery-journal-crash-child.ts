import { writeSync } from 'node:fs';
import { createFileRecoveryJournals } from './node';
import type { RecoveryJournalEntry } from './recovery-journal';

/**
 * Child process of the crash test: acknowledges one entry, then ends itself with SIGKILL partway
 * through writing the next line, so the test can reopen what a real process death left.
 */
const root = process.env.JOURNAL_ROOT ?? '';
const killMidLine = process.env.JOURNAL_KILL === 'mid-line';
const scope = { conversationId: 'room', participantId: 'alice' };

let writes = 0;
const journal = createFileRecoveryJournals(root, {
  io: {
    writeSync: (fd, data) => {
      writes += 1;
      if (killMidLine && writes === 2) {
        writeSync(fd, data.subarray(0, Math.floor(data.length / 2)));
        process.kill(process.pid, 'SIGKILL');
      }
      return writeSync(fd, data);
    },
  },
}).journal(scope);

const entry = (n: number): RecoveryJournalEntry => ({
  kind: 'effect-call',
  attemptId: 'a1',
  actionId: `act-${n}`,
  callId: `effect:${n}`,
});

async function run(): Promise<void> {
  await journal.append(entry(1));
  await journal.append(entry(2));
}

run().then(
  () => process.stdout.write('done\n'),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
