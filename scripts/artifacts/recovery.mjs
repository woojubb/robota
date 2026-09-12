/** Explicit recovery never steals a live writer's lock or deletes the previous output. */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATION_DIRECTORY, validateOutputName } from './writer-lock.mjs';
import { pinGeneration } from './generation.mjs';

function claimRecovery(lock) {
  if (!lstatSync(lock).isDirectory()) throw new Error('artifact: invalid writer lock');
  const claim = path.join(lock, 'recovery.lock');
  const record = JSON.stringify({ pid: process.pid, host: hostname(), id: randomUUID() });
  try {
    mkdirSync(claim);
    writeFileSync(path.join(claim, 'owner.json'), record, { flag: 'wx' });
  } catch (error) {
    // Even an incomplete claim record requires quiescence; never infer permission to steal it.
    throw new Error(
      `artifact: exclusive recovery claim unavailable; recovery required: ${claim}; ` +
        'stop all writers and recoverers, inspect retained records, remove only this claim, then retry',
      { cause: error },
    );
  }
  return record;
}

function requireClaim(lock, record) {
  // A live writer can finish during its ownership check. Only a dead writer AND our still-held
  // exclusive claim make the lock stable; a nonce re-read without that claim is not exclusion.
  try {
    if (readFileSync(path.join(lock, 'recovery.lock/owner.json'), 'utf8') !== record) {
      throw new Error('claim replaced');
    }
  } catch (error) {
    throw new Error('artifact: recovery claim lost; recovery required; files retained', {
      cause: error,
    });
  }
}

function requireDeadWriter(lock) {
  if (!lstatSync(lock).isDirectory()) throw new Error('artifact: invalid writer lock');
  const owner = JSON.parse(readFileSync(path.join(lock, 'owner.json'), 'utf8'));
  if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    throw new Error('artifact: cannot establish interrupted writer ownership');
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error(`artifact: writer ${owner.pid} is still running; recovery refused`);
}

function releaseClaimedLock(lock) {
  // Free the writer address atomically; recursive deletion must never revisit that reusable path.
  const retired = path.join(path.dirname(lock), `recovered-${randomUUID()}.lock`);
  renameSync(lock, retired);
  rmSync(retired, { recursive: true });
}

export function recoverGeneration(packageRoot) {
  const owner = realpathSync(packageRoot);
  const store = path.join(owner, GENERATION_DIRECTORY);
  if (!lstatSync(store).isDirectory()) throw new Error('artifact: owned generation store required');
  const lock = path.join(store, 'writer.lock');
  const claim = claimRecovery(lock);
  requireDeadWriter(lock);
  requireClaim(lock, claim);
  const journal = path.join(store, 'transaction.json');
  if (!lstatSync(journal, { throwIfNoEntry: false })) {
    releaseClaimedLock(lock);
    return { action: 'released-interrupted-stage' };
  }
  const transaction = JSON.parse(readFileSync(journal, 'utf8'));
  if (transaction.version !== 1 || !/^[a-f0-9-]{36}$/u.test(transaction.id)) {
    throw new Error('artifact: invalid recovery transaction; files retained');
  }
  const directory = path.join(store, transaction.id);
  if (!lstatSync(directory).isDirectory()) throw new Error('artifact: owned generation required');
  const backup = path.join(directory, 'previous-dist');
  const destination = path.join(owner, validateOutputName(transaction.outputName));
  const action = reconcileDestination(owner, destination, backup, transaction.id);
  unlinkSync(journal);
  releaseClaimedLock(lock);
  return { action };
}

function reconcileDestination(owner, destination, backup, id) {
  const current = lstatSync(destination, { throwIfNoEntry: false });
  const previous = lstatSync(backup, { throwIfNoEntry: false });
  if (!current) {
    if (!previous)
      throw new Error('artifact: neither previous output nor dist exists; recovery required');
    renameSync(backup, destination);
    return 'restored-previous';
  }
  if (
    current.isSymbolicLink() &&
    pinGeneration(owner, { outputName: path.basename(destination) }).id === id
  ) {
    return 'finalized-publication';
  }
  if (!previous && (current.isDirectory() || current.isSymbolicLink())) return 'kept-previous';
  throw new Error('artifact: unexpected dist is present; refusing to overwrite during recovery');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = recoverGeneration(process.argv[2] ?? process.cwd());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
