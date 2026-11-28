import { FileConversationStore } from './file-store';
import type { ConversationClaim } from './store-types';

/**
 * Child process of the crash test: performs one store operation and ends itself with SIGKILL when
 * the write reaches the named checkpoint, so the test can reopen what a real process death left.
 */
const root = process.env.STORE_ROOT ?? '';
const operation = process.env.STORE_OPERATION ?? '';
const killAt = process.env.STORE_KILL_AT ?? '';
const claim = JSON.parse(process.env.STORE_CLAIM ?? 'null') as ConversationClaim | null;

const store = new FileConversationStore({
  root,
  checkpoint: (point) => {
    if (point === killAt) process.kill(process.pid, 'SIGKILL');
  },
});

async function run(): Promise<string> {
  if (operation === 'commit' && claim) {
    const envelope = await store.commit({
      claim,
      expectedRevision: 1,
      operationId: 'victim',
      state: { step: 2 },
    });
    return JSON.stringify(envelope);
  }
  if (operation === 'renew' && claim) return JSON.stringify(await store.renew(claim, 120_000));
  if (operation === 'claim') return JSON.stringify(await store.claim('room', 'child', 120_000));
  throw new Error(`unknown operation ${operation}`);
}

run().then(
  (reply) => {
    process.stdout.write(`${reply}\n`);
  },
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  },
);
