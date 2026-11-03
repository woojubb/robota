import {
  ArtifactCorruptError,
  isCurrentSealedArtifactBytes,
  isSealedArtifactBytes,
} from '@robota-sdk/agent-core';
import { assertSessionSealing } from '@robota-sdk/agent-session';

import { MANIFEST_FILE, SNAPSHOT_DIR } from './edit-checkpoint-store-helpers.js';

import type { IEditCheckpointStateStorage } from './edit-checkpoint-state-storage.js';
import type { IArtifactContext, IArtifactSealer } from '@robota-sdk/agent-core';
import type { TSessionSealing } from '@robota-sdk/agent-session';
import type { IWorkspaceDirectoryEntry } from '../workspace-trust/index.js';

/** The characters `safePathSegment` leaves and turn names use; never `:` or `|`, so an id parses one way. */
const PLACE_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const PREIMAGE_FILE = /^(\d+)\.content$/u;

/**
 * A sealed checkpoint file in a framing a newer build writes: intact as far as this build can tell,
 * and not one it opens. Fixed text, so it carries nothing of the file.
 */
export class EditCheckpointNewerFramingError extends Error {
  constructor() {
    super('The checkpoint file was sealed by a newer build and does not open here.');
    this.name = 'EditCheckpointNewerFramingError';
  }
}

/**
 * What a checkpoint file at `relativePath` is sealed as, from its place alone: a manifest at
 * `<session>/<turn>/manifest.json` is `<session>:<turn>`, a pre-image at
 * `<session>/<turn>/files/<NNNNNN>.content` is `<session>:<turn>:<NNNNNN>`. Anything else has no
 * place a checkpoint file can be, and is `undefined`.
 */
export function artifactContextOf(relativePath: string): IArtifactContext | undefined {
  const segments = relativePath.split(/[\\/]/u);
  const [session, turn] = segments;
  if (session === undefined || turn === undefined) return undefined;
  if (!PLACE_SEGMENT.test(session) || !PLACE_SEGMENT.test(turn)) return undefined;
  if (segments.length === 3 && segments[2] === MANIFEST_FILE) {
    return { kind: 'checkpoint-manifest', id: `${session}:${turn}` };
  }
  const preimage =
    segments.length === 4 && segments[2] === SNAPSHOT_DIR ? PREIMAGE_FILE.exec(segments[3]!) : null;
  return preimage === null
    ? undefined
    : { kind: 'checkpoint-preimage', id: `${session}:${turn}:${preimage[1]}` };
}

/** State that can replace a file whole, which sealed state writes its manifests through. */
type TReplacingState = IEditCheckpointStateStorage &
  Required<Pick<IEditCheckpointStateStorage, 'replaceBytes'>>;

/**
 * Checkpoint state that seals every manifest and pre-image it writes, bound to the place it is
 * written, so one moved to another turn or session does not open there. A manifest replaces any file
 * at its place whole, so a crash leaves the old one or the new, never a torn one that reads as damaged.
 * `readText` and `readBytes` open what they read; the store reads what it wrote before it sealed — a
 * plain manifest and that manifest's pre-images — as stored, through `readStoredBytes`, so nothing is
 * ever guessed from its first bytes. Every read is of bytes, never the inner state's text read.
 * Opening fails by throwing `ArtifactLockedError`, `ArtifactCorruptError` (also for a file that is not
 * sealed, or not at a checkpoint file's place) or {@link EditCheckpointNewerFramingError}.
 */
export class SealedEditCheckpointState implements IEditCheckpointStateStorage {
  readonly seals = true;

  constructor(
    private readonly inner: TReplacingState,
    private readonly sealer: IArtifactSealer,
    /** The state never held a plain checkpoint, so a plain manifest in it can only be planted. */
    readonly sealedOnly: boolean,
  ) {}

  get rootRelativePath(): string | undefined {
    return this.inner.rootRelativePath;
  }

  readText(relativePath: string, purpose: string): string | undefined {
    const bytes = this.readBytes(relativePath, purpose);
    return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
  }

  readBytes(relativePath: string, purpose: string): Uint8Array | undefined {
    const stored = this.readStoredBytes(relativePath, purpose);
    return stored === undefined ? undefined : this.openStoredBytes(relativePath, stored);
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    this.writeBytes(relativePath, Buffer.from(content, 'utf8'), purpose);
  }

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    const context = artifactContextOf(relativePath);
    if (context === undefined) {
      throw new RangeError('Only a checkpoint manifest or pre-image is written to sealed state.');
    }
    const sealed = this.sealer.sealBytes(content, context);
    if (context.kind === 'checkpoint-manifest') {
      this.inner.replaceBytes(relativePath, sealed, purpose);
    } else {
      this.inner.writeBytes(relativePath, sealed, purpose);
    }
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    return this.inner.listDirectory(relativePath, purpose);
  }

  /** The bytes at `relativePath` exactly as stored, sealed or not. */
  readStoredBytes(relativePath: string, purpose: string): Uint8Array | undefined {
    return this.inner.readBytes(relativePath, purpose);
  }

  /** Opens `stored`, read from `relativePath`; the caller owns the result and may wipe it. */
  openStoredBytes(relativePath: string, stored: Uint8Array): Uint8Array {
    const context = artifactContextOf(relativePath);
    if (context === undefined || !isSealedArtifactBytes(stored)) throw new ArtifactCorruptError();
    if (!isCurrentSealedArtifactBytes(stored)) throw new EditCheckpointNewerFramingError();
    return this.sealer.openBytes(stored, context);
  }
}

/**
 * `state`, sealing as `sealing` says: `'plain'` returns `state` itself, so a host that keeps
 * checkpoints plain writes exactly what it always did; `{ sealer }` returns state that seals every
 * manifest and pre-image to its place in the checkpoint directory, and needs `state` to replace a file
 * whole (`replaceBytes`). A store given sealed state keeps reading the plain checkpoints written
 * before it sealed, each with its own pre-images — only those numbered below every sealed one, since
 * nothing after that is written plain — and none at all with `sealedOnly`, for state that never held a
 * plain checkpoint (one made for a single process).
 */
export function createSealedEditCheckpointState(
  state: IEditCheckpointStateStorage,
  sealing: TSessionSealing,
  options: { readonly sealedOnly?: boolean } = {},
): IEditCheckpointStateStorage {
  assertSessionSealing(sealing);
  if (sealing === 'plain') return state;
  if (state.seals === true) throw new RangeError('The checkpoint state already seals.');
  if (typeof state.replaceBytes !== 'function') {
    throw new RangeError('Sealed checkpoint state needs state that can replace a file whole.');
  }
  return new SealedEditCheckpointState(
    state as TReplacingState,
    sealing.sealer,
    options.sealedOnly === true,
  );
}
