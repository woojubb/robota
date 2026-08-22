import { relative, resolve } from 'node:path';

import {
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';
import { assertWorkspaceProjectMutationForAuthority } from '../workspace-trust/project-mutation.js';

import type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
} from './edit-checkpoint-types.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

/** Authority-backed checkpoint I/O kept separate from branch/history orchestration. */
export class EditCheckpointAuthorityIO {
  readonly cwd: string;
  private readonly reader;
  private readonly state;
  private readonly mutation;

  constructor(authority: IWorkspaceProjectAuthority, mutation: IWorkspaceProjectMutation) {
    this.cwd = resolve(getWorkspaceProjectIdentity(authority).worktreeRoot);
    this.reader = getWorkspaceProjectReader(authority);
    this.state = getWorkspaceProjectStateStorage(authority, 'checkpoints');
    this.mutation = assertWorkspaceProjectMutationForAuthority(mutation, authority);
  }

  inspectKind(relativePath: string): TWorkspaceContributionKind | undefined {
    return this.reader.inspectKind(relativePath, 'inspect checkpoint capture target');
  }

  captureFile(
    originalPath: string,
    relativePath: string,
    snapshotPath: string,
    snapshotFile: string,
  ): IEditCheckpointFileRecord {
    const content = this.reader.readBytes(relativePath, 'capture checkpoint file preimage');
    if (content === undefined) return { originalPath, existed: false };
    this.state.writeBytes(snapshotPath, content, 'persist checkpoint file preimage');
    return { originalPath, existed: true, snapshotFile };
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

  private toProjectRelativePath(originalPath: string): string {
    const candidate = resolve(originalPath);
    const relativePath = relative(this.cwd, candidate);
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      resolve(this.cwd, relativePath) !== candidate
    ) {
      throw new Error(`Checkpoint path is outside the authorized project: ${originalPath}`);
    }
    return relativePath;
  }
}
