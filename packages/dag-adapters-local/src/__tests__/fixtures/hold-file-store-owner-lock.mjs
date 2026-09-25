// Helper process for file-store-owner-lock.test.ts's cross-process case: acquires the given
// storage root's owner lock (by constructing a real `FileStoragePort` and driving one operation),
// prints "held" once it holds the lock, then waits for a "release" line on stdin before closing the
// lock and exiting. Run under `tsx/esm` so it can import the TypeScript source directly.
import { FileStoragePort } from '../../file-storage-port.ts';

const [root] = process.argv.slice(2);
if (!root) {
  console.error('usage: hold-file-store-owner-lock.mjs <storageRoot>');
  process.exit(1);
}

const storage = new FileStoragePort(root);
// Any operation acquires the owner lock as its first step, before hydration or the operation itself.
await storage.listDagRuns();
process.stdout.write('held\n');

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (chunk.toString().includes('release')) {
    storage
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  }
});
