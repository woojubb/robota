import { resolve } from 'node:path';

import { SEALED_ARTIFACT_MAX_OVERHEAD_BYTES } from '@robota-sdk/agent-core';

import {
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';
import { assertWorkspaceProjectMutationForAuthority } from '../workspace-trust/project-mutation.js';
import { MAX_PROJECT_READ_BYTES } from '../workspace-trust/project-reader-path.js';

import { relativeInsideProject } from './edit-checkpoint-store-helpers.js';

import type { IEditCheckpointStateStorage } from './edit-checkpoint-state-storage.js';
import type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
} from './edit-checkpoint-types.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

/**
 * The most plaintext a sealed pre-image holds, so its sealed file stays within the project
 * reader's read limit; a larger file is refused at capture exactly as one over that limit is.
 */
export const SEALED_PREIMAGE_MAX_BYTES =
  MAX_PROJECT_READ_BYTES - SEALED_ARTIFACT_MAX_OVERHEAD_BYTES;

/** Authority-backed checkpoint I/O kept separate from branch/history orchestration. */
export class EditCheckpointAuthorityIO {
  readonly cwd: string;
  private readonly reader;
  private readonly state: IEditCheckpointStateStorage;
  private readonly mutation;

  /** Absent when the state is held outside the project, so no project path can be inside it. */
  get checkpointRootRelativePath(): string | undefined {
    return this.state.rootRelativePath;
  }

  /** Whether the state seals what it writes. */
  get seals(): boolean {
    return this.state.seals === true;
  }

  /**
   * `stateStorage` is where manifests and pre-images are kept, sealed or not as it says; restoring a
   * checkpoint still writes the project's files back through `mutation`.
   */
  constructor(
    authority: IWorkspaceProjectAuthority,
    mutation: IWorkspaceProjectMutation,
    stateStorage: IEditCheckpointStateStorage,
  ) {
    this.cwd = resolve(getWorkspaceProjectIdentity(authority).worktreeRoot);
    this.reader = getWorkspaceProjectReader(authority);
    this.state = stateStorage;
    this.mutation = assertWorkspaceProjectMutationForAuthority(mutation, authority);
  }

  acquireTurn(sessionId: string) {
    if (this.state.acquireTurn === undefined) {
      throw new Error('Checkpoint storage must support an exclusive session writer lease.');
    }
    const lease = this.state.acquireTurn(sessionId, 'acquire checkpoint writer');
    if (lease === undefined)
      throw new Error('Another checkpoint writer is active for this session.');
    return lease;
  }

  claimDirectory(path: string): boolean {
    if (this.state.claimDirectory === undefined) {
      throw new Error('Checkpoint storage must support atomic directory claims.');
    }
    return this.state.claimDirectory(path, 'claim a new edit checkpoint');
  }

  inspectKind(relativePath: string): TWorkspaceContributionKind | undefined {
    return this.reader.inspectKind(relativePath, 'inspect checkpoint capture target');
  }

  /**
   * Sealed state caps the pre-image so its sealed file stays readable, refusing a larger file as
   * the reader refuses any file past its limit, and records its size so inspecting opens nothing.
   */
  captureFile(
    originalPath: string,
    relativePath: string,
    snapshotPath: string,
    snapshotFile: string,
  ): IEditCheckpointFileRecord {
    const purpose = 'capture checkpoint file preimage';
    const content = this.seals
      ? this.reader.readBytes(relativePath, purpose, SEALED_PREIMAGE_MAX_BYTES)
      : this.reader.readBytes(relativePath, purpose);
    if (content === undefined) return { originalPath, existed: false };
    this.state.writeBytes(snapshotPath, content, 'persist checkpoint file preimage');
    return this.seals
      ? { originalPath, existed: true, snapshotFile, byteLength: content.byteLength }
      : { originalPath, existed: true, snapshotFile };
  }

  restoreFile(snapshotPath: string | undefined, record: IEditCheckpointFileRecord): void {
    const target = this.toProjectRelativePath(record.originalPath);
    if (!record.existed) {
      this.mutation.deleteFile(target, 'remove checkpoint-created file');
      return;
    }
    if (snapshotPath === undefined) {
      throw new Error(`Checkpoint file record is missing a snapshot: ${record.originalPath}`);
    }
    const snapshot = this.state.readBytes(snapshotPath, 'load checkpoint file preimage');
    if (snapshot === undefined) {
      throw new Error(`Checkpoint snapshot is missing: ${record.originalPath}`);
    }
    this.mutation.writeBytes(target, snapshot, 'restore checkpoint file preimage');
  }

  /** Writes back what `record` says, from a pre-image already read and verified. */
  restoreVerifiedFile(record: IEditCheckpointFileRecord, preimage: Uint8Array | undefined): void {
    const target = this.toProjectRelativePath(record.originalPath);
    if (!record.existed) {
      this.mutation.deleteFile(target, 'remove checkpoint-created file');
      return;
    }
    if (preimage === undefined) {
      throw new Error(`Checkpoint file record is missing a snapshot: ${record.originalPath}`);
    }
    this.mutation.writeBytes(target, preimage, 'restore checkpoint file preimage');
  }

  readSnapshotBytes(path: string): Uint8Array | undefined {
    return this.state.readBytes(path, 'inspect checkpoint snapshot');
  }

  listDirectories(path: string): readonly string[] {
    return this.state
      .listDirectory(path, 'list checkpoint manifests')
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => entry.name);
  }

  readManifest(path: string): IEditCheckpointManifest | undefined {
    const raw = this.state.readText(path, 'load checkpoint manifest');
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as IEditCheckpointManifest;
    } catch {
      // allow-fallback: corrupted checkpoint manifests are excluded from the usable tree.
      return undefined;
    }
  }

  writeManifest(path: string, manifest: IEditCheckpointManifest): void {
    this.state.writeText(path, JSON.stringify(manifest, null, 2), 'persist checkpoint manifest');
  }

  /** The project-relative form of a manifest's `originalPath`; throws when it is not inside the project. */
  toProjectRelativePath(originalPath: string): string {
    const relativePath = relativeInsideProject(this.cwd, resolve(originalPath));
    if (relativePath === undefined) {
      throw new Error(`Checkpoint path is outside the authorized project: ${originalPath}`);
    }
    return relativePath;
  }
}
