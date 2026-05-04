import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  IPromptFileReferenceDiagnostic,
  IPromptFileReferenceLimits,
  IPromptFileReferenceResolveOptions,
  IPromptFileReferenceToken,
  IResolvedPromptFileReference,
  IResolvedPromptFileReferences,
  TPromptFileReferenceDiagnosticCode,
} from './prompt-file-reference-types.js';
import { parsePromptFileReferences } from './prompt-file-reference-parser.js';
import {
  isPathWithinRoot,
  normalizeRelativePath,
  resolveCandidatePath,
} from './prompt-file-reference-paths.js';
export type {
  IPromptFileReferenceDiagnostic,
  IPromptFileReferenceHistoryData,
  IPromptFileReferenceLimits,
  IPromptFileReferenceRecord,
  IPromptFileReferenceResolveOptions,
  IPromptFileReferenceToken,
  IResolvedPromptFileReference,
  IResolvedPromptFileReferences,
  TPromptFileReferenceDiagnosticCode,
  TPromptFileReferenceReason,
} from './prompt-file-reference-types.js';
export {
  buildPromptWithFileReferences,
  createPromptFileReferenceHistoryEntry,
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  toPromptFileReferenceRecords,
} from './prompt-file-reference-format.js';
export { parsePromptFileReferences } from './prompt-file-reference-parser.js';

const DEFAULT_MAX_DEPTH = Number('2');
const DEFAULT_MAX_REFERENCES = Number('8');
const BYTES_PER_KIB = Number('1024');
const DEFAULT_MAX_FILE_BYTES = Number('64') * BYTES_PER_KIB;
const DEFAULT_MAX_TOTAL_BYTES = Number('256') * BYTES_PER_KIB;

interface IResolvedLimits {
  maxDepth: number;
  maxReferences: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

interface IResolveState {
  rootPath: string;
  limits: IResolvedLimits;
  references: IResolvedPromptFileReference[];
  diagnostics: IPromptFileReferenceDiagnostic[];
  loadedPaths: Set<string>;
  totalBytes: number;
}

interface IReferenceFileInfo {
  sourcePath: string;
  byteLength: number;
}

export async function resolvePromptFileReferences(
  input: string,
  options: IPromptFileReferenceResolveOptions,
): Promise<IResolvedPromptFileReferences> {
  const rootPath = await resolveWorkspaceRoot(options.cwd);
  const state: IResolveState = {
    rootPath,
    limits: resolveLimits(options.limits),
    references: [],
    diagnostics: [],
    loadedPaths: new Set<string>(),
    totalBytes: 0,
  };

  for (const reference of parsePromptFileReferences(input)) {
    await resolveReference(reference, 0, [], state);
  }

  return {
    references: state.references,
    diagnostics: state.diagnostics,
  };
}

function resolveLimits(limits: IPromptFileReferenceLimits | undefined): IResolvedLimits {
  return {
    maxDepth: limits?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxReferences: limits?.maxReferences ?? DEFAULT_MAX_REFERENCES,
    maxFileBytes: limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
}

async function resolveWorkspaceRoot(cwd: string): Promise<string> {
  try {
    return await realpath(cwd);
  } catch {
    return resolve(cwd);
  }
}

async function resolveReference(
  reference: IPromptFileReferenceToken,
  depth: number,
  activePaths: readonly string[],
  state: IResolveState,
): Promise<void> {
  if (!checkReferenceBudget(reference, depth, state)) return;

  const sourcePath = await resolveReferencePath(reference, state);
  if (sourcePath === undefined) return;
  if (!checkReferenceCycleAndDuplicate(reference, sourcePath, activePaths, state)) return;

  const fileInfo = await inspectReferenceFile(reference, sourcePath, state);
  if (fileInfo === undefined) return;

  const content = await readReferenceFile(reference, sourcePath, state);
  if (content === undefined) return;

  state.loadedPaths.add(sourcePath);
  state.totalBytes += fileInfo.byteLength;
  state.references.push(buildResolvedReference(reference, fileInfo, depth, content, state));
  await resolveNestedReferences(content, depth, [...activePaths, sourcePath], state);
}

function checkReferenceBudget(
  reference: IPromptFileReferenceToken,
  depth: number,
  state: IResolveState,
): boolean {
  if (state.references.length >= state.limits.maxReferences) {
    pushDiagnostic(state, 'too-many-references', reference, 'Too many file references.');
    return false;
  }
  if (depth > state.limits.maxDepth) {
    pushDiagnostic(state, 'max-depth', reference, 'File reference nesting is too deep.');
    return false;
  }
  return true;
}

async function resolveReferencePath(
  reference: IPromptFileReferenceToken,
  state: IResolveState,
): Promise<string | undefined> {
  const candidatePath = resolveCandidatePath(reference.path, state.rootPath);
  if (!isPathWithinRoot(candidatePath, state.rootPath)) {
    pushDiagnostic(state, 'outside-root', reference, 'Referenced path is outside the workspace.');
    return undefined;
  }

  try {
    const sourcePath = await realpath(candidatePath);
    if (isPathWithinRoot(sourcePath, state.rootPath)) return sourcePath;
    pushDiagnostic(
      state,
      'outside-root',
      reference,
      'Referenced path resolves outside the workspace.',
    );
  } catch {
    pushDiagnostic(state, 'not-found', reference, 'Referenced file was not found.');
  }
  return undefined;
}

function checkReferenceCycleAndDuplicate(
  reference: IPromptFileReferenceToken,
  sourcePath: string,
  activePaths: readonly string[],
  state: IResolveState,
): boolean {
  if (activePaths.includes(sourcePath)) {
    pushDiagnostic(state, 'circular-reference', reference, 'Circular file reference detected.');
    return false;
  }
  return !state.loadedPaths.has(sourcePath);
}

async function inspectReferenceFile(
  reference: IPromptFileReferenceToken,
  sourcePath: string,
  state: IResolveState,
): Promise<IReferenceFileInfo | undefined> {
  try {
    const fileStat = await stat(sourcePath);
    if (fileStat.isDirectory()) {
      pushDiagnostic(
        state,
        'directory-not-supported',
        reference,
        'Directory references are not supported.',
      );
      return undefined;
    }
    if (fileStat.size > state.limits.maxFileBytes) {
      pushDiagnostic(
        state,
        'file-too-large',
        reference,
        'Referenced file exceeds the per-file size limit.',
      );
      return undefined;
    }
    if (state.totalBytes + fileStat.size > state.limits.maxTotalBytes) {
      pushDiagnostic(
        state,
        'total-too-large',
        reference,
        'Referenced files exceed the total size limit.',
      );
      return undefined;
    }
    return { sourcePath, byteLength: fileStat.size };
  } catch {
    pushDiagnostic(state, 'unreadable', reference, 'Referenced file could not be inspected.');
    return undefined;
  }
}

async function readReferenceFile(
  reference: IPromptFileReferenceToken,
  sourcePath: string,
  state: IResolveState,
): Promise<string | undefined> {
  try {
    return await readFile(sourcePath, 'utf8');
  } catch {
    pushDiagnostic(state, 'unreadable', reference, 'Referenced file could not be read.');
    return undefined;
  }
}

function buildResolvedReference(
  reference: IPromptFileReferenceToken,
  fileInfo: IReferenceFileInfo,
  depth: number,
  content: string,
  state: IResolveState,
): IResolvedPromptFileReference {
  return {
    originalReference: reference.original,
    sourcePath: fileInfo.sourcePath,
    relativePath: normalizeRelativePath(state.rootPath, fileInfo.sourcePath),
    reason: 'prompt-reference',
    depth,
    byteLength: fileInfo.byteLength,
    content,
  };
}

async function resolveNestedReferences(
  content: string,
  depth: number,
  activePaths: readonly string[],
  state: IResolveState,
): Promise<void> {
  for (const nestedReference of parsePromptFileReferences(content)) {
    await resolveReference(nestedReference, depth + 1, activePaths, state);
  }
}

function pushDiagnostic(
  state: IResolveState,
  code: TPromptFileReferenceDiagnosticCode,
  reference: IPromptFileReferenceToken,
  message: string,
): void {
  state.diagnostics.push({
    code,
    severity: 'error',
    reference: reference.original,
    message,
    path: reference.path,
  });
}
