import { isAbsolute, win32 } from 'node:path';

import { parsePromptFileReferences } from './prompt-file-reference-parser.js';
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type {
  IPromptFileReferenceDiagnostic,
  IPromptFileReferenceLimits,
  IPromptFileReferenceResolveOptions,
  IPromptFileReferenceToken,
  IResolvedPromptFileReference,
  IResolvedPromptFileReferences,
  TPromptFileReferenceDiagnosticCode,
  TPromptFileReferenceReason,
} from './prompt-file-reference-types.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

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
  reader: IWorkspaceProjectReader;
  startRelativeDirectory: string;
  limits: IResolvedLimits;
  reason: TPromptFileReferenceReason;
  references: IResolvedPromptFileReference[];
  diagnostics: IPromptFileReferenceDiagnostic[];
  loadedPaths: Set<string>;
  totalBytes: number;
}

export async function resolvePromptFileReferences(
  input: string,
  options: IPromptFileReferenceResolveOptions,
): Promise<IResolvedPromptFileReferences> {
  const state = createResolveState(options);
  for (const reference of parsePromptFileReferences(input)) {
    resolveReference(reference, 0, [], state);
  }
  return toResolvedReferences(state);
}

export async function resolvePromptFileReferencePaths(
  referencePaths: readonly string[],
  options: IPromptFileReferenceResolveOptions,
): Promise<IResolvedPromptFileReferences> {
  const state = createResolveState(options);
  for (const referencePath of referencePaths) {
    resolveReference(
      { original: `@${referencePath}`, path: referencePath, index: 0 },
      0,
      [],
      state,
    );
  }
  return toResolvedReferences(state);
}

function createResolveState(options: IPromptFileReferenceResolveOptions): IResolveState {
  return {
    reader: assertWorkspaceProjectReader(options.reader),
    startRelativeDirectory: normalizeStartDirectory(options.startRelativeDirectory),
    limits: resolveLimits(options.limits),
    reason: options.reason ?? 'prompt-reference',
    references: [],
    diagnostics: [],
    loadedPaths: new Set<string>(),
    totalBytes: 0,
  };
}

function normalizeStartDirectory(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  const normalized = value.replaceAll('\\', '/');
  if (hasUnsafePathShape(normalized)) {
    throw new Error('Prompt reference start directory must stay within the authorized project.');
  }
  return normalized;
}

function resolveLimits(limits: IPromptFileReferenceLimits | undefined): IResolvedLimits {
  return {
    maxDepth: limits?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxReferences: limits?.maxReferences ?? DEFAULT_MAX_REFERENCES,
    maxFileBytes: limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
}

function resolveReference(
  reference: IPromptFileReferenceToken,
  depth: number,
  activePaths: readonly string[],
  state: IResolveState,
): void {
  if (!checkReferenceBudget(reference, depth, state)) return;
  const sourcePath = resolveReferencePath(reference, state);
  if (sourcePath === undefined) return;
  if (!checkReferenceCycleAndDuplicate(reference, sourcePath, activePaths, state)) return;

  const content = readReferenceFile(reference, sourcePath, state);
  if (content === undefined) return;
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (!checkByteBudget(reference, byteLength, state)) return;

  state.loadedPaths.add(sourcePath);
  state.totalBytes += byteLength;
  state.references.push({
    originalReference: reference.original,
    sourcePath,
    relativePath: sourcePath,
    reason: state.reason,
    depth,
    byteLength,
    content,
  });
  resolveNestedReferences(content, depth, [...activePaths, sourcePath], state);
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

function hasUnsafePathShape(value: string): boolean {
  const segments = value.split('/');
  return (
    value.startsWith('~/') ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function resolveReferencePath(
  reference: IPromptFileReferenceToken,
  state: IResolveState,
): string | undefined {
  const normalized = reference.path.replaceAll('\\', '/');
  if (hasUnsafePathShape(normalized)) {
    pushDiagnostic(state, 'outside-root', reference, 'Referenced path is outside the workspace.');
    return undefined;
  }
  const sourcePath =
    state.startRelativeDirectory === ''
      ? normalized
      : `${state.startRelativeDirectory}/${normalized}`;
  const kind = state.reader.inspectKind(sourcePath, 'inspect prompt file reference');
  if (kind === undefined) {
    pushDiagnostic(state, 'not-found', reference, 'Referenced file was not found.');
    return undefined;
  }
  if (kind === 'link') {
    pushDiagnostic(state, 'outside-root', reference, 'Referenced path is a refused symbolic link.');
    return undefined;
  }
  if (kind === 'directory') {
    pushDiagnostic(
      state,
      'directory-not-supported',
      reference,
      'Directory references are not supported.',
    );
    return undefined;
  }
  if (kind !== 'file') {
    pushDiagnostic(state, 'unreadable', reference, 'Referenced file could not be inspected.');
    return undefined;
  }
  return sourcePath;
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

function readReferenceFile(
  reference: IPromptFileReferenceToken,
  sourcePath: string,
  state: IResolveState,
): string | undefined {
  const content = state.reader.readText(sourcePath, 'load prompt file reference');
  if (content !== undefined) return content;
  pushDiagnostic(state, 'not-found', reference, 'Referenced file was not found.');
  return undefined;
}

function checkByteBudget(
  reference: IPromptFileReferenceToken,
  byteLength: number,
  state: IResolveState,
): boolean {
  if (byteLength > state.limits.maxFileBytes) {
    pushDiagnostic(
      state,
      'file-too-large',
      reference,
      'Referenced file exceeds the per-file size limit.',
    );
    return false;
  }
  if (state.totalBytes + byteLength > state.limits.maxTotalBytes) {
    pushDiagnostic(
      state,
      'total-too-large',
      reference,
      'Referenced files exceed the total size limit.',
    );
    return false;
  }
  return true;
}

function resolveNestedReferences(
  content: string,
  depth: number,
  activePaths: readonly string[],
  state: IResolveState,
): void {
  for (const nestedReference of parsePromptFileReferences(content)) {
    resolveReference(nestedReference, depth + 1, activePaths, state);
  }
}

function toResolvedReferences(state: IResolveState): IResolvedPromptFileReferences {
  return { references: state.references, diagnostics: state.diagnostics };
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
