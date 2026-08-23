import { listActiveContextReferences } from '../context/context-reference-inventory.js';
import { parsePromptFileReferences } from '../context/prompt-file-reference-parser.js';
import { resolveProjectPromptStart } from '../context/prompt-file-reference-paths.js';
import {
  buildPromptWithFileReferences,
  createPromptFileReferenceHistoryEntry,
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  resolvePromptFileReferences,
  resolvePromptFileReferencePaths,
  toPromptFileReferenceRecords,
} from '../context/prompt-file-references.js';
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';

import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

export interface IPreparedPromptInput {
  modelInput: string;
  hookInput?: string;
  promptFileReferenceRecords: IPromptFileReferenceRecord[];
  activeContextReferenceRecords: IPromptFileReferenceRecord[];
  promptFileReferenceEntry?: IHistoryEntry;
}

export async function preparePromptInput(
  input: string,
  projectAccess: TWorkspaceProjectAccess,
  cwd: string,
  rawInput?: string,
  contextReferences: readonly IContextReferenceItem[] = [],
): Promise<IPreparedPromptInput> {
  const activePaths = listActiveContextReferences(contextReferences).map(
    (reference) => reference.sourcePath,
  );
  if (projectAccess.status !== 'trusted') {
    if (activePaths.length > 0 || parsePromptFileReferences(input).length > 0) {
      throw new WorkspaceAuthorityRequiredError(
        'Prompt file references require explicit workspace project authority.',
      );
    }
    return {
      modelInput: input,
      ...(rawInput !== undefined ? { hookInput: rawInput } : {}),
      activeContextReferenceRecords: [],
      promptFileReferenceRecords: [],
    };
  }
  return prepareTrustedPromptInput(input, projectAccess, cwd, rawInput, activePaths);
}

async function prepareTrustedPromptInput(
  input: string,
  projectAccess: Extract<TWorkspaceProjectAccess, { status: 'trusted' }>,
  cwd: string,
  rawInput: string | undefined,
  activePaths: readonly string[],
): Promise<IPreparedPromptInput> {
  const resolveOptions = {
    reader: getWorkspaceProjectReader(projectAccess.authority),
    startRelativeDirectory: resolveProjectPromptStart(projectAccess.identity.worktreeRoot, cwd),
  };
  const activeReferenceResult = await resolvePromptFileReferencePaths(activePaths, {
    ...resolveOptions,
    reason: 'manual',
  });
  const promptFileReferenceResult = await resolvePromptFileReferences(input, resolveOptions);
  const diagnostics = [
    ...activeReferenceResult.diagnostics,
    ...promptFileReferenceResult.diagnostics,
  ];
  if (hasBlockingPromptFileReferenceDiagnostics(diagnostics)) {
    throw new Error(formatPromptFileReferenceDiagnostics(diagnostics));
  }
  const resolvedReferences = dedupeResolvedReferences([
    ...activeReferenceResult.references,
    ...promptFileReferenceResult.references,
  ]);
  const modelInput = buildPromptWithFileReferences(input, resolvedReferences);
  const hookInput = rawInput ?? (modelInput === input ? undefined : input);
  const activeContextReferenceRecords = toPromptFileReferenceRecords(
    activeReferenceResult.references,
  );
  const promptFileReferenceRecords = toPromptFileReferenceRecords(
    promptFileReferenceResult.references,
  );
  const promptFileReferenceEntry =
    promptFileReferenceResult.references.length > 0
      ? createPromptFileReferenceHistoryEntry(promptFileReferenceResult.references)
      : undefined;
  return {
    modelInput,
    ...(hookInput !== undefined ? { hookInput } : {}),
    activeContextReferenceRecords,
    promptFileReferenceRecords,
    ...(promptFileReferenceEntry !== undefined ? { promptFileReferenceEntry } : {}),
  };
}

function dedupeResolvedReferences(
  references: readonly (IPromptFileReferenceRecord & { content: string })[],
): Array<IPromptFileReferenceRecord & { content: string }> {
  return [...new Map(references.map((reference) => [reference.sourcePath, reference])).values()];
}
