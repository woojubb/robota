import { createHash } from 'node:crypto';
import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import type { JsonValue } from './json-value';

/** A stored file that does not match the layout. It is reported, never repaired. */
export class FileStoreCorruptionError extends Error {
  readonly code = 'corrupt' as const;
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`Conversation store file is corrupt (${reason}): ${path}`);
    this.name = 'FileStoreCorruptionError';
  }
}

/** One committed revision; `operationId` and `fingerprint` are null only for revision 0. */
export interface RevisionRecord {
  schemaVersion: 1;
  conversationId: string;
  revision: number;
  state: JsonValue;
  operationId: string | null;
  fingerprint: string | null;
}

/**
 * One generation of the claim state, published create-only as `claims/<generation>.json`; the highest
 * generation is the state. The fence outlives every claim and only a successful claim raises it;
 * `claim` is null while no owner holds the conversation.
 */
export interface ClaimRecord {
  schemaVersion: 1;
  generation: number;
  fence: number;
  claim: { ownerId: string; expiresAt: number } | null;
}

/** The state before any claim: generation 0 has no file. */
export const EMPTY_CLAIM: ClaimRecord = { schemaVersion: 1, generation: 0, fence: 0, claim: null };

/** Longest id in bytes; its hex form must fit a 255-byte file name. */
const MAX_ID_BYTES = 120;

export function encodeConversationId(id: unknown): string {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    !id.isWellFormed() ||
    Buffer.byteLength(id, 'utf8') > MAX_ID_BYTES
  ) {
    throw new RoundtableError(
      'invalid-config',
      `Conversation id must be a non-empty string of at most ${MAX_ID_BYTES} UTF-8 bytes`,
    );
  }
  return Buffer.from(id, 'utf8').toString('hex');
}

/** The commit's retry identity: the same revision and state, whatever the property order. */
export function fingerprintOf(expectedRevision: number, state: JsonValue): string {
  return createHash('sha256').update(canonicalJson({ expectedRevision, state })).digest('hex');
}

function parseObject(raw: string, path: string, keys: readonly string[]): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FileStoreCorruptionError(path, 'not valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FileStoreCorruptionError(path, 'not an object');
  }
  const actual = Object.keys(value).sort();
  if (actual.join() !== [...keys].sort().join()) {
    throw new FileStoreCorruptionError(path, `unexpected fields ${actual.join(',')}`);
  }
  return value as Record<string, unknown>;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseRevision(
  raw: string,
  path: string,
  conversationId: string,
  revision: number,
): RevisionRecord {
  const fields = parseObject(raw, path, [
    'schemaVersion',
    'conversationId',
    'revision',
    'state',
    'operationId',
    'fingerprint',
  ]);
  const bad = (reason: string) => new FileStoreCorruptionError(path, reason);
  if (fields.schemaVersion !== 1) throw bad('unsupported schemaVersion');
  if (fields.conversationId !== conversationId) throw bad('conversation id mismatch');
  if (fields.revision !== revision) throw bad('revision does not match the file name');
  try {
    canonicalJson(fields.state);
  } catch {
    throw bad('state is not JSON data');
  }
  const state = fields.state as JsonValue;
  if (revision === 0) {
    if (fields.operationId !== null || fields.fingerprint !== null) {
      throw bad('revision 0 carries an operation');
    }
  } else if (
    typeof fields.operationId !== 'string' ||
    fields.operationId.length === 0 ||
    fields.fingerprint !== fingerprintOf(revision - 1, state)
  ) {
    throw bad('operation id or fingerprint is invalid');
  }
  return {
    schemaVersion: 1,
    conversationId,
    revision,
    state,
    operationId: fields.operationId as string | null,
    fingerprint: fields.fingerprint as string | null,
  };
}

export function parseClaim(raw: string, path: string, generation: number): ClaimRecord {
  const fields = parseObject(raw, path, ['schemaVersion', 'generation', 'fence', 'claim']);
  if (fields.schemaVersion !== 1 || fields.generation !== generation || !isCount(fields.fence)) {
    throw new FileStoreCorruptionError(path, 'invalid schemaVersion, generation or fence');
  }
  if (fields.claim === null) {
    return { schemaVersion: 1, generation, fence: fields.fence, claim: null };
  }
  const owner = fields.claim as { ownerId?: unknown; expiresAt?: unknown } | undefined;
  if (
    owner === undefined ||
    typeof owner !== 'object' ||
    Object.keys(owner).sort().join() !== 'expiresAt,ownerId' ||
    typeof owner.ownerId !== 'string' ||
    owner.ownerId.length === 0 ||
    !Number.isSafeInteger(owner.expiresAt)
  ) {
    throw new FileStoreCorruptionError(path, 'invalid claim');
  }
  return {
    schemaVersion: 1,
    generation,
    fence: fields.fence,
    claim: { ownerId: owner.ownerId, expiresAt: owner.expiresAt as number },
  };
}

/** Matches `<n>.json` with no leading zeros; anything else in a revisions or claims directory is corrupt. */
export function revisionNumber(name: string): number | undefined {
  const match = /^(0|[1-9]\d*)\.json$/u.exec(name);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) ? value : undefined;
}
