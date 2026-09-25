// Child process for the multi-process owner-lock stress test: on each "go" message it races to
// acquire the given root's owner lock and reports whether it won; "release" releases a won lock.
import { FileStoreOwnerLock } from '../../file-store-owner-lock.ts';

let held;
process.on('message', async (message) => {
  if (message.type === 'go') {
    while (Date.now() < message.startAt) {
      // Spin so every racer starts within the same millisecond.
    }
    try {
      held = await FileStoreOwnerLock.acquire(message.root);
      process.send({ type: 'result', won: true });
    } catch (error) {
      process.send({ type: 'result', won: false, error: error.name });
    }
  } else if (message.type === 'release') {
    await held?.release();
    held = undefined;
    process.send({ type: 'released' });
  } else if (message.type === 'exit') {
    process.exit(0);
  }
});
process.send({ type: 'ready' });
