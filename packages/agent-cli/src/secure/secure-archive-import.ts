import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';
import { getWorkspaceProjectStateStorage, type IWorkspaceProjectStateStorage } from '@robota-sdk/agent-framework';
import { inspectPromptHistoryFile } from '@robota-sdk/agent-session/node';

import { createProductArchivePromptHistoryFile } from '../product/session-stores.js';
import { createCliRuntimeContext } from '../product/runtime-context.js';
import { BrokeredWorkspaceTrustService } from '../startup/brokered-workspace-trust.js';
import { KeyHolderArtifactSealer } from '@robota-sdk/agent-local-host';
import { discoverProjectRoots } from './migration-roots.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { KeyHolder } from '@robota-sdk/agent-local-host';
import type { IPromptHistorySource } from '@robota-sdk/agent-interface/session';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Read one ordinary owner file without following a link or accepting another hard-link name. */
function readOwnedFile(path: string): Uint8Array | undefined {
  const named = lstatSync(path, { throwIfNoEntry: false });
  if (named === undefined) return undefined;
  const uid = process.getuid?.();
  if (!named.isFile() || named.nlink !== 1 || named.size > MAX_FILE_BYTES ||
      (uid !== undefined && named.uid !== uid)) {
    throw new Error(`The archive file ${path} is not an ordinary owned file within the read limit.`);
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino ||
        opened.nlink !== 1 || opened.size > MAX_FILE_BYTES) {
      throw new Error(`The archive file ${path} changed while it was opened.`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sourceDirectory(path: string): boolean {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata === undefined) return false;
  const uid = process.getuid?.();
  if (!metadata.isDirectory() || (uid !== undefined && metadata.uid !== uid)) {
    throw new Error(`The archive directory ${path} is not an ordinary owned directory.`);
  }
  return true;
}

function putFile(
  source: string,
  target: string,
  recheck: () => void,
): void {
  const bytes = readOwnedFile(source);
  if (bytes === undefined) return;
  const existing = readOwnedFile(target);
  if (existing !== undefined) {
    if (Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
      throw new Error(`The sealed archive already contains a different file at ${target}; both copies were kept.`);
    }
    return;
  }
  recheck();
  writeOwnerOnlyFile(target, bytes, { durable: true, createOnly: true, beforeCommit: recheck });
  const verified = readOwnedFile(target);
  if (verified === undefined || Buffer.compare(Buffer.from(verified), Buffer.from(bytes)) !== 0) {
    throw new Error(`The sealed archive copy at ${target} could not be verified.`);
  }
}

function putTree(source: string, target: string, recheck: () => void): void {
  if (!sourceDirectory(source)) return;
  ensureOwnerOnlyDirectory(target);
  for (const name of readdirSync(source).sort()) {
    const from = join(source, name);
    const to = join(target, name);
    const entry = lstatSync(from);
    if (entry.isDirectory()) putTree(from, to, recheck);
    else if (entry.isFile()) putFile(from, to, recheck);
    else throw new Error(`The archive entry ${from} is not an ordinary file or directory.`);
  }
}

async function historyEntries(file: IPromptHistorySource): Promise<readonly string[]> {
  const entries: string[] = [];
  for await (const block of file.read({ signal: new AbortController().signal })) {
    if (block.skippedLines > 0 || block.unreadable !== undefined) {
      throw new Error('The prompt history contains a line that cannot be opened for import.');
    }
    entries.push(...block.entries.map((entry) => JSON.stringify(entry)));
  }
  return entries.reverse();
}

/** Merge by opened entry, because sealing the same prompt again changes its ciphertext. */
async function putHistory(
  source: string,
  target: string,
  holder: KeyHolder,
  recheck: () => void,
): Promise<void> {
  const sourceBytes = readOwnedFile(source);
  if (sourceBytes === undefined) return;
  const oldBytes = readOwnedFile(target);
  const sealer = new KeyHolderArtifactSealer(holder);
  try {
    for (const path of oldBytes === undefined ? [source] : [source, target]) {
      const inspection = inspectPromptHistoryFile(path, { sealer });
      if (inspection.status !== 'present' || inspection.plainLines > 0 || inspection.unreadableLines > 0) {
        throw new Error(`The prompt history at ${path} is not completely sealed and readable.`);
      }
    }
    const sourceEntries = await historyEntries(createProductArchivePromptHistoryFile(source, sealer));
    const oldEntries = oldBytes === undefined
      ? []
      : await historyEntries(createProductArchivePromptHistoryFile(target, sealer));
    const present = new Set(oldEntries);
    const additions = sourceEntries.filter((entry) => {
      if (present.has(entry)) return false;
      present.add(entry);
      return true;
    });
    if (additions.length === 0) return;
    const temporary = `${target}.import-${process.pid}-${randomUUID()}`;
    try {
      const writer = createProductArchivePromptHistoryFile(temporary, sealer);
      for (const entry of additions) writer.append(JSON.parse(entry));
      const appended = readOwnedFile(temporary);
      if (appended === undefined) throw new Error('The staged prompt history was not written.');
      const content = oldBytes === undefined
        ? appended
        : Buffer.concat([Buffer.from(oldBytes), Buffer.from(appended)]);
      recheck();
      writeOwnerOnlyFile(target, content, {
        durable: true,
        createOnly: oldBytes === undefined,
        beforeCommit: () => {
          recheck();
          const live = readOwnedFile(target);
          if (
            (oldBytes === undefined && live !== undefined) ||
            (oldBytes !== undefined && (live === undefined ||
              Buffer.compare(Buffer.from(live), Buffer.from(oldBytes)) !== 0))
          ) {
            throw new Error('The sealed prompt history changed during import; rerun secure enable.');
          }
        },
      });
      const verified = readOwnedFile(target);
      if (verified === undefined || Buffer.compare(Buffer.from(verified), Buffer.from(content)) !== 0) {
        throw new Error('The sealed prompt history import could not be verified.');
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  } finally {
    sealer.dispose();
  }
}

/** Copy already sealed legacy bytes; retain their source as a sealed recovery archive. */
export async function importSealedUserArchive(
  runtime: ICliRuntimeContext,
  holder: KeyHolder,
  recheck: () => void,
): Promise<void> {
  const userRoot = runtime.layout.userRoot;
  const secureRoot = join(userRoot, 'secure-v1');
  ensureOwnerOnlyDirectory(secureRoot, { withinRoot: userRoot });
  putTree(runtime.layout.userPaths.sessions, join(secureRoot, 'sessions'), recheck);
  await putHistory(runtime.layout.userPaths.history, join(secureRoot, 'history.jsonl'), holder, recheck);
  const logRoot = runtime.config.storage.logRoot;
  if (!sourceDirectory(logRoot)) return;
  for (const name of readdirSync(logRoot).sort()) {
    if (name === 'secure-v1') continue;
    const parent = join(logRoot, name);
    if (!sourceDirectory(parent)) continue;
    putTree(join(parent, 'subagents'), join(logRoot, 'secure-v1', name, 'subagents'), recheck);
  }
}

function importProjectTree(
  source: IWorkspaceProjectStateStorage,
  target: IWorkspaceProjectStateStorage,
  directory: string,
  recheck: () => void,
): void {
  for (const entry of source.listDirectory(directory, 'import sealed conversation archive')) {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.kind === 'directory') {
      importProjectTree(source, target, path, recheck);
      continue;
    }
    if (entry.kind !== 'file') {
      throw new Error(`The project archive contains a non-file entry at ${source.projectRelativePath(path)}.`);
    }
    const bytes = source.readBytes(path, 'import sealed conversation archive');
    if (bytes === undefined) throw new Error('A project archive file disappeared during import.');
    const existing = target.readBytes(path, 'compare sealed conversation archive');
    if (existing !== undefined) {
      if (Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
        throw new Error(`The sealed project archive already contains different bytes at ${target.projectRelativePath(path)}; both copies were kept.`);
      }
      continue;
    }
    recheck();
    target.writeBytes(path, bytes, 'import sealed conversation archive');
    const verified = target.readBytes(path, 'verify sealed conversation archive');
    if (verified === undefined || Buffer.compare(Buffer.from(verified), Buffer.from(bytes)) !== 0) {
      throw new Error(`The sealed project archive copy at ${target.projectRelativePath(path)} could not be verified.`);
    }
  }
}

/** The broker mints both source and target authorities for the same live trusted root. */
export async function importSealedProjectArchives(
  runtime: ICliRuntimeContext,
  holder: KeyHolder,
  recheck: () => void,
): Promise<void> {
  const sealer = new KeyHolderArtifactSealer(holder);
  let roots: Awaited<ReturnType<typeof discoverProjectRoots>>;
  try {
    roots = await discoverProjectRoots(runtime, sealer);
  } finally {
    sealer.dispose();
  }
  if (roots.listed.length > 0) {
    throw new Error('Some project conversation roots are not safely writable; resolve the listed roots before enabling secure conversations.');
  }
  if (roots.trusted.length === 0) return;
  const secureRuntime = createCliRuntimeContext(
    runtime.config, runtime.environment, runtime.artifact, 'secure',
  );
  const service = await BrokeredWorkspaceTrustService.create(secureRuntime);
  for (const project of roots.trusted) {
    recheck();
    const access = await service.inspect(project.root);
    if (access.status !== 'trusted') {
      throw new Error(`Project ${project.root} is no longer trusted for secure archive import.`);
    }
    for (const namespace of ['sessions', 'session-logs', 'checkpoints'] as const) {
      importProjectTree(
        getWorkspaceProjectStateStorage(project.authority, namespace),
        getWorkspaceProjectStateStorage(access.authority, namespace),
        '',
        recheck,
      );
    }
  }
}
