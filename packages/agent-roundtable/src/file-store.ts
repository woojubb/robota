import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import {
  EMPTY_CLAIM,
  FileStoreCorruptionError,
  encodeConversationId,
  fingerprintOf,
  parseClaim,
  parseRevision,
  revisionNumber,
} from './file-store-format';
import type { ClaimRecord, RevisionRecord } from './file-store-format';
import {
  OWNER_ONLY_DIRECTORY,
  errorCode,
  isTempName,
  linkExclusive,
  renameOver,
  syncDirectory,
  sweepDeadTemps,
  tempPath,
  writeSyncedTemp,
} from './file-store-io';
import type { CheckpointHook } from './file-store-io';
import { DirectoryLock } from './file-store-lock';
import type { JsonValue } from './json-value';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationEnvelope,
  ConversationStore,
} from './store-types';

export interface FileConversationStoreOptions {
  /** Directory that holds one subdirectory per conversation; created owner-only when missing. */
  root: string;
  /** UTC Unix milliseconds; defaults to `Date.now`. Governs claim leases only. */
  now?: () => number;
  /** How long a process may hold a conversation's claim lock before another may break it. */
  lockTtlMs?: number;
  /** How long a call waits for a live lock holder before failing with `busy`. */
  lockWaitMs?: number;
  /** Test seam: called at each named step of a write, where a test can end the process. */
  checkpoint?: CheckpointHook;
}

/** What one instance remembers of a conversation; every revision file is immutable, so it never goes stale. */
interface Known {
  head: RevisionRecord;
  receipts: Map<string, { revision: number; fingerprint: string }>;
}

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 10_000;

/**
 * A durable `ConversationStore` over a local directory, for one host. Each commit is an immutable
 * `revisions/<n>.json` published with a create-only hard link, which is the compare-and-set: of two
 * writers racing for revision n exactly one links it. Claims and the fence they carry are one small
 * record replaced atomically under a per-conversation lock file. Every file read is validated and a
 * damaged one is an error, never repaired. Old revisions are kept, because a retried commit must
 * get its original receipt back.
 */
export class FileConversationStore implements ConversationStore {
  readonly durability = 'durable' as const;
  private readonly root: string;
  private readonly now: () => number;
  private readonly lockTtlMs: number;
  private readonly lockWaitMs: number;
  private readonly checkpoint?: CheckpointHook;
  private readonly known = new Map<string, Known>();
  private rootReady = false;

  constructor(options: FileConversationStoreOptions) {
    if (!options.root) throw new RoundtableError('invalid-config', 'Store root is required');
    this.root = options.root;
    this.now = options.now ?? Date.now;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
    this.checkpoint = options.checkpoint;
  }

  async create(conversationId: string, state: JsonValue): Promise<ConversationEnvelope> {
    const directory = this.directory(conversationId);
    canonicalJson(state);
    await this.ensureRoot();
    await this.makeDirectory(directory, this.root);
    await this.makeDirectory(join(directory, 'revisions'), directory);
    const record: RevisionRecord = {
      schemaVersion: 1,
      conversationId,
      revision: 0,
      state,
      operationId: null,
      fingerprint: null,
    };
    if ((await this.publishRevision(directory, record)) === 'exists') {
      throw new RoundtableError('conflict', 'Conversation already exists');
    }
    return envelopeOf(record);
  }

  async load(conversationId: string): Promise<ConversationEnvelope | undefined> {
    const known = await this.refresh(conversationId);
    return known && envelopeOf(known.head);
  }

  async claim(
    conversationId: string,
    ownerId: string,
    leaseMs: number,
  ): Promise<ConversationClaim> {
    await this.requireConversation(conversationId);
    this.expiry(leaseMs);
    if (!ownerId) throw new RoundtableError('invalid-config', 'Claim owner id is required');
    return this.locked(conversationId, async () => {
      const current = await this.readClaim(conversationId);
      if (current.claim && current.claim.expiresAt > this.now()) {
        throw new RoundtableError('busy', 'Conversation has an unexpired owner');
      }
      const next = { ownerId, expiresAt: this.expiry(leaseMs) };
      await this.writeClaim(conversationId, {
        ...EMPTY_CLAIM,
        fence: current.fence + 1,
        claim: next,
      });
      return { conversationId, ownerId, fence: current.fence + 1, expiresAt: next.expiresAt };
    });
  }

  async renew(claim: ConversationClaim, leaseMs: number): Promise<ConversationClaim> {
    const id = claim.conversationId;
    await this.requireConversation(id);
    return this.locked(id, async () => {
      const current = await this.assertOwned(claim);
      const expiresAt = this.expiry(leaseMs);
      await this.writeClaim(id, { ...current, claim: { ownerId: claim.ownerId, expiresAt } });
      return { ...claim, expiresAt };
    });
  }

  async release(claim: ConversationClaim): Promise<void> {
    const id = claim.conversationId;
    await this.requireConversation(id);
    await this.locked(id, async () => {
      const current = await this.assertOwned(claim);
      await this.writeClaim(id, { ...current, claim: null });
    });
  }

  async commit(change: ConversationCommit): Promise<ConversationEnvelope> {
    if (!change.operationId) {
      throw new RoundtableError('invalid-config', 'Commit operation id is required');
    }
    const id = change.claim.conversationId;
    const fingerprint = fingerprintOf(change.expectedRevision, change.state);
    const directory = this.directory(id);
    const replay = await this.receiptFor(id, change.operationId, fingerprint);
    if (replay) return replay;
    return this.locked(id, async () => {
      const known = await this.requireConversation(id);
      const again = await this.receiptFor(id, change.operationId, fingerprint);
      if (again) return again;
      await this.assertOwned(change.claim);
      if (known.head.revision !== change.expectedRevision) {
        throw new RoundtableError('conflict', 'Conversation revision changed');
      }
      const record: RevisionRecord = {
        schemaVersion: 1,
        conversationId: id,
        revision: change.expectedRevision + 1,
        state: change.state,
        operationId: change.operationId,
        fingerprint,
      };
      if ((await this.publishRevision(directory, record)) === 'exists') {
        throw new RoundtableError('conflict', 'Conversation revision changed');
      }
      known.head = record;
      known.receipts.set(change.operationId, { revision: record.revision, fingerprint });
      return envelopeOf(record);
    });
  }

  async lookupOperation(
    conversationId: string,
    operationId: string,
  ): Promise<ConversationEnvelope | undefined> {
    const known = await this.refresh(conversationId);
    const receipt = known?.receipts.get(operationId);
    return receipt ? this.readEnvelope(conversationId, receipt.revision) : undefined;
  }

  private directory(conversationId: string): string {
    return join(this.root, encodeConversationId(conversationId));
  }

  private async ensureRoot(): Promise<void> {
    if (this.rootReady) return;
    await mkdir(this.root, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    this.rootReady = true;
  }

  /** Creates a directory owner-only and flushes its entry in the parent; an existing one is kept. */
  private async makeDirectory(path: string, parent: string): Promise<void> {
    try {
      await mkdir(path, { mode: OWNER_ONLY_DIRECTORY });
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return;
      throw error;
    }
    await syncDirectory(parent);
  }

  /** Writes `revisions/<n>.json` create-only: temp file flushed, linked into place, directory flushed. */
  private async publishRevision(
    directory: string,
    record: RevisionRecord,
  ): Promise<'created' | 'exists'> {
    const revisions = join(directory, 'revisions');
    const temp = tempPath(revisions);
    await writeSyncedTemp(
      temp,
      JSON.stringify(record),
      { written: 'temp-write', synced: 'temp-synced' },
      this.checkpoint,
    );
    try {
      const outcome = await linkExclusive(temp, join(revisions, `${record.revision}.json`));
      if (outcome === 'created') {
        await this.checkpoint?.('linked');
        await syncDirectory(revisions);
      }
      return outcome;
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }

  /** Brings what this instance knows up to the files on disk; undefined when the conversation does not exist. */
  private async refresh(conversationId: string): Promise<Known | undefined> {
    const directory = this.directory(conversationId);
    const revisions = join(directory, 'revisions');
    let known = this.known.get(conversationId);
    const numbers = await this.listRevisions(revisions, directory, known !== undefined);
    if (numbers === undefined) return undefined;
    if (!known) await Promise.all([sweepDeadTemps(directory), sweepDeadTemps(revisions)]);
    const top = numbers[numbers.length - 1];
    if (known && top < known.head.revision) {
      throw new FileStoreCorruptionError(revisions, 'a known revision disappeared');
    }
    for (let n = known ? known.head.revision + 1 : 0; n <= top; n++) {
      const record = await this.readRevision(conversationId, n);
      if (!known) {
        known = { head: record, receipts: new Map() };
        this.known.set(conversationId, known);
      }
      known.head = record;
      if (record.operationId !== null) {
        if (known.receipts.has(record.operationId)) {
          throw new FileStoreCorruptionError(revisions, 'an operation id appears twice');
        }
        known.receipts.set(record.operationId, {
          revision: n,
          fingerprint: record.fingerprint as string,
        });
      }
    }
    return known;
  }

  /** The sorted revision numbers, which must be 0..n with no gap; undefined when there is no revision 0 yet. */
  private async listRevisions(
    revisions: string,
    directory: string,
    mustExist: boolean,
  ): Promise<number[] | undefined> {
    for (let attempt = 0; ; attempt++) {
      let names: string[];
      try {
        names = await readdir(revisions);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        if (mustExist) throw new FileStoreCorruptionError(directory, 'conversation disappeared');
        return undefined;
      }
      const numbers: number[] = [];
      for (const name of names) {
        if (isTempName(name)) continue;
        const n = revisionNumber(name);
        if (n === undefined)
          throw new FileStoreCorruptionError(join(revisions, name), 'unexpected file');
        numbers.push(n);
      }
      numbers.sort((a, b) => a - b);
      if (numbers.length === 0) return undefined;
      if (numbers.every((n, i) => n === i)) return numbers;
      // A listing taken while a writer links can race it once; a gap that persists is damage.
      if (attempt > 0) throw new FileStoreCorruptionError(revisions, 'revision numbers have a gap');
    }
  }

  private async readRevision(conversationId: string, revision: number): Promise<RevisionRecord> {
    const path = join(this.directory(conversationId), 'revisions', `${revision}.json`);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new FileStoreCorruptionError(path, 'revision vanished');
      throw error;
    }
    return parseRevision(raw, path, conversationId, revision);
  }

  private async readEnvelope(
    conversationId: string,
    revision: number,
  ): Promise<ConversationEnvelope> {
    return envelopeOf(await this.readRevision(conversationId, revision));
  }

  /** The stored reply for a retried operation, a conflict when the id was used for another commit. */
  private async receiptFor(
    conversationId: string,
    operationId: string,
    fingerprint: string,
  ): Promise<ConversationEnvelope | undefined> {
    const known = await this.requireConversation(conversationId);
    const receipt = known.receipts.get(operationId);
    if (!receipt) return undefined;
    if (receipt.fingerprint !== fingerprint) {
      throw new RoundtableError('conflict', 'Operation id was used for another commit');
    }
    return this.readEnvelope(conversationId, receipt.revision);
  }

  private async requireConversation(conversationId: string): Promise<Known> {
    const known = await this.refresh(conversationId);
    if (!known) throw new RoundtableError('conflict', 'Conversation does not exist');
    return known;
  }

  private locked<T>(conversationId: string, action: () => Promise<T>): Promise<T> {
    const lock = new DirectoryLock(join(this.directory(conversationId), 'claim.lock'), {
      ttlMs: this.lockTtlMs,
      waitMs: this.lockWaitMs,
      checkpoint: this.checkpoint,
    });
    return lock.run(action);
  }

  private async readClaim(conversationId: string): Promise<ClaimRecord> {
    const path = join(this.directory(conversationId), 'claim.json');
    try {
      return parseClaim(await readFile(path, 'utf8'), path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return EMPTY_CLAIM;
      throw error;
    }
  }

  /** The claim must be the current, unexpired one; must run under the conversation lock to stay true. */
  private async assertOwned(claim: ConversationClaim): Promise<ClaimRecord> {
    const current = await this.readClaim(claim.conversationId);
    if (
      !current.claim ||
      current.fence !== claim.fence ||
      current.claim.ownerId !== claim.ownerId ||
      current.claim.expiresAt <= this.now()
    ) {
      throw new RoundtableError('stale-claim', 'Conversation claim expired or changed owner');
    }
    return current;
  }

  private async writeClaim(conversationId: string, record: ClaimRecord): Promise<void> {
    const directory = this.directory(conversationId);
    const temp = tempPath(directory, 'claim-');
    await writeSyncedTemp(
      temp,
      JSON.stringify(record),
      { written: 'claim-write', synced: 'claim-synced' },
      this.checkpoint,
    );
    try {
      await renameOver(temp, join(directory, 'claim.json'));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    await this.checkpoint?.('claim-renamed');
    await syncDirectory(directory);
  }

  private expiry(leaseMs: number): number {
    const now = this.now();
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isSafeInteger(now + leaseMs)) {
      throw new RoundtableError(
        'invalid-config',
        'Lease duration and clock must produce a finite expiry',
      );
    }
    return now + leaseMs;
  }
}

function envelopeOf(record: RevisionRecord): ConversationEnvelope {
  return {
    schemaVersion: 1,
    conversationId: record.conversationId,
    revision: record.revision,
    state: structuredClone(record.state),
  };
}
