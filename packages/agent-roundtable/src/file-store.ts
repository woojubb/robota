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
  syncDirectory,
  sweepDeadTemps,
  tempPath,
  writeSyncedTemp,
} from './file-store-io';
import type { CheckpointHook } from './file-store-io';
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
  /** Test seam: called at each named step of a write, where a test can end the process. */
  checkpoint?: CheckpointHook;
}

/** What one instance remembers of a conversation; every revision file is immutable, so it never goes stale. */
interface Known {
  head: RevisionRecord;
  receipts: Map<string, { revision: number; fingerprint: string }>;
}

/** How many times a claim change re-reads after losing the race for a generation before it gives up. */
const MAX_CLAIM_ATTEMPTS = 64;

/**
 * A durable `ConversationStore` over a local directory, for one host. Each commit is an immutable
 * `revisions/<n>.json` published with a create-only hard link, which is the compare-and-set: of two
 * writers racing for revision n exactly one links it. Claims are published the same way, as numbered
 * generations `claims/<g>.json` that carry the fence; the highest generation is the state, so no lock
 * is needed for safety. Every file read is validated and a damaged one is an error, never repaired. Old revisions are kept, because a retried commit must
 * get its original receipt back.
 */
export class FileConversationStore implements ConversationStore {
  readonly durability = 'durable' as const;
  private readonly root: string;
  private readonly now: () => number;
  private readonly checkpoint?: CheckpointHook;
  private readonly known = new Map<string, Known>();
  private rootReady = false;

  constructor(options: FileConversationStoreOptions) {
    if (!options.root) throw new RoundtableError('invalid-config', 'Store root is required');
    this.root = options.root;
    this.now = options.now ?? Date.now;
    this.checkpoint = options.checkpoint;
  }

  async create(conversationId: string, state: JsonValue): Promise<ConversationEnvelope> {
    const directory = this.directory(conversationId);
    canonicalJson(state);
    await this.ensureRoot();
    await this.makeDirectory(directory, this.root);
    await this.makeDirectory(join(directory, 'revisions'), directory);
    await this.makeDirectory(join(directory, 'claims'), directory);
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
    return this.changeClaim(conversationId, (current) => {
      if (current.claim && current.claim.expiresAt > this.now()) {
        throw new RoundtableError('busy', 'Conversation has an unexpired owner');
      }
      const fence = current.fence + 1;
      const expiresAt = this.expiry(leaseMs);
      return {
        next: { fence, claim: { ownerId, expiresAt } },
        result: { conversationId, ownerId, fence, expiresAt },
      };
    });
  }

  async renew(claim: ConversationClaim, leaseMs: number): Promise<ConversationClaim> {
    const id = claim.conversationId;
    await this.requireConversation(id);
    return this.changeClaim(id, (current) => {
      this.assertOwned(claim, current);
      const expiresAt = this.expiry(leaseMs);
      return {
        next: { fence: current.fence, claim: { ownerId: claim.ownerId, expiresAt } },
        result: { ...claim, expiresAt },
      };
    });
  }

  async release(claim: ConversationClaim): Promise<void> {
    const id = claim.conversationId;
    await this.requireConversation(id);
    await this.changeClaim(id, (current) => {
      this.assertOwned(claim, current);
      return { next: { fence: current.fence, claim: null }, result: undefined };
    });
  }

  async commit(change: ConversationCommit): Promise<ConversationEnvelope> {
    if (!change.operationId) {
      throw new RoundtableError('invalid-config', 'Commit operation id is required');
    }
    const id = change.claim.conversationId;
    const fingerprint = fingerprintOf(change.expectedRevision, change.state);
    const directory = this.directory(id);
    // One snapshot decides everything: a retry whose operation already landed gets its receipt, as in
    // the memory store, before ownership or the revision are looked at.
    const known = await this.requireConversation(id);
    const receipt = known.receipts.get(change.operationId);
    const headRevision = known.head.revision;
    if (receipt) return this.replay(id, receipt, change.operationId, fingerprint);
    try {
      this.assertOwned(change.claim, await this.readClaim(id));
    } catch (error) {
      // The same operation may have landed after the snapshot, before the lease ended.
      const landed = (await this.requireConversation(id)).receipts.get(change.operationId);
      if (landed) return this.replay(id, landed, change.operationId, fingerprint);
      throw error;
    }
    if (headRevision !== change.expectedRevision) {
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
      // A writer that linked first may be the same operation retried; its receipt is the answer.
      const winner = (await this.requireConversation(id)).receipts.get(change.operationId);
      if (winner) return this.replay(id, winner, change.operationId, fingerprint);
      throw new RoundtableError('conflict', 'Conversation revision changed');
    }
    known.head = record;
    known.receipts.set(change.operationId, { revision: record.revision, fingerprint });
    return envelopeOf(record);
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
    if (!known) {
      await Promise.all(
        [directory, revisions, join(directory, 'claims')].map((path) => sweepDeadTemps(path)),
      );
    }
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
      if (numbers.length === 0) {
        if (mustExist) throw new FileStoreCorruptionError(revisions, 'known revisions disappeared');
        return undefined;
      }
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
  private async replay(
    conversationId: string,
    receipt: { revision: number; fingerprint: string },
    operationId: string,
    fingerprint: string,
  ): Promise<ConversationEnvelope> {
    if (receipt.fingerprint !== fingerprint) {
      throw new RoundtableError(
        'conflict',
        `Operation id ${operationId} was used for another commit`,
      );
    }
    return this.readEnvelope(conversationId, receipt.revision);
  }

  private async requireConversation(conversationId: string): Promise<Known> {
    const known = await this.refresh(conversationId);
    if (!known) throw new RoundtableError('conflict', 'Conversation does not exist');
    return known;
  }

  /** The highest published claim generation, or the empty state when none exists. */
  private async readClaim(conversationId: string): Promise<ClaimRecord> {
    const claims = join(this.directory(conversationId), 'claims');
    for (;;) {
      const top = (await this.listClaims(claims)).at(-1);
      if (top === undefined) return EMPTY_CLAIM;
      const path = join(claims, `${top}.json`);
      try {
        return parseClaim(await readFile(path, 'utf8'), path, top);
      } catch (error) {
        // A newer generation was published and this one pruned between the listing and the read.
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
  }

  private async listClaims(claims: string): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(claims);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    const generations: number[] = [];
    for (const name of names) {
      if (isTempName(name)) continue;
      const n = revisionNumber(name);
      if (n === undefined || n < 1) {
        throw new FileStoreCorruptionError(join(claims, name), 'unexpected file');
      }
      generations.push(n);
    }
    return generations.sort((a, b) => a - b);
  }

  /** The claim must be the current, unexpired one. */
  private assertOwned(claim: ConversationClaim, current: ClaimRecord): void {
    if (
      !current.claim ||
      current.fence !== claim.fence ||
      current.claim.ownerId !== claim.ownerId ||
      current.claim.expiresAt <= this.now()
    ) {
      throw new RoundtableError('stale-claim', 'Conversation claim expired or changed owner');
    }
  }

  /**
   * Applies a change to the claim state as the next generation. Of two writers that read the same
   * generation exactly one links the next one; the other re-reads and decides again against the
   * state that won, so a fence is never issued twice and no lock is needed.
   */
  private async changeClaim<T>(
    conversationId: string,
    decide: (current: ClaimRecord) => { next: Pick<ClaimRecord, 'fence' | 'claim'>; result: T },
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      const current = await this.readClaim(conversationId);
      const { next, result } = decide(current);
      const record: ClaimRecord = { schemaVersion: 1, generation: current.generation + 1, ...next };
      if ((await this.publishClaim(conversationId, record)) === 'created') return result;
    }
    throw new RoundtableError('busy', 'Conversation claim is contended');
  }

  /**
   * Publishes `claims/<g>.json` create-only. Afterwards the generation must still be the highest: a
   * writer that stalled can link a name an earlier prune freed, below a newer generation, and that
   * file is withdrawn rather than believed. Generations below the winner are then pruned.
   */
  private async publishClaim(
    conversationId: string,
    record: ClaimRecord,
  ): Promise<'created' | 'exists'> {
    const directory = this.directory(conversationId);
    const claims = join(directory, 'claims');
    await this.makeDirectory(claims, directory);
    const temp = tempPath(claims, 'claim-');
    await writeSyncedTemp(
      temp,
      JSON.stringify(record),
      { written: 'claim-write', synced: 'claim-synced' },
      this.checkpoint,
    );
    const final = join(claims, `${record.generation}.json`);
    try {
      if ((await linkExclusive(temp, final)) === 'exists') return 'exists';
      await this.checkpoint?.('claim-linked');
      await syncDirectory(claims);
      const generations = await this.listClaims(claims);
      if (generations[generations.length - 1] !== record.generation) {
        await unlink(final).catch(() => undefined);
        return 'exists';
      }
      for (const older of generations.slice(0, -1)) {
        await unlink(join(claims, `${older}.json`)).catch(() => undefined);
      }
      return 'created';
    } finally {
      await unlink(temp).catch(() => undefined);
    }
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
