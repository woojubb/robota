import { isAbsolutePath, relativePath, utf8ByteLength } from '@robota-sdk/agent-core';

import {
  createContextReferenceItem,
  upsertContextReference,
} from '../context/context-reference-inventory.js';
import { resolveProjectPromptStart } from '../context/prompt-file-reference-paths.js';
import {
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  resolvePromptFileReferencePaths,
  toPromptFileReferenceRecords,
} from '../context/prompt-file-references.js';
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';

import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceItem,
} from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

export interface IAddInteractiveContextReferenceResult {
  references: IContextReferenceItem[];
  result: IContextReferenceAddResult;
}

export async function addInteractiveContextReference(
  references: readonly IContextReferenceItem[],
  path: string,
  projectAccess: TWorkspaceProjectAccess,
  cwd: string,
): Promise<IAddInteractiveContextReferenceResult> {
  if (projectAccess.status !== 'trusted') {
    throw new WorkspaceAuthorityRequiredError(
      'Adding a project context reference requires explicit workspace project authority.',
    );
  }
  const result = await resolvePromptFileReferencePaths([path], {
    reader: getWorkspaceProjectReader(projectAccess.authority),
    startRelativeDirectory: resolveProjectPromptStart(projectAccess.identity.worktreeRoot, cwd),
    reason: 'manual',
  });
  if (hasBlockingPromptFileReferenceDiagnostics(result.diagnostics)) {
    return {
      references: [...references],
      result: {
        evicted: [],
        diagnostics: [formatPromptFileReferenceDiagnostics(result.diagnostics)],
      },
    };
  }

  const reference = result.references[0];
  if (!reference) {
    return {
      references: [...references],
      result: { evicted: [], diagnostics: ['No context reference was resolved.'] },
    };
  }

  const item = createContextReferenceItem(
    toPromptFileReferenceRecords([reference])[0]!,
    'manual',
    'active',
  );
  const upserted = upsertContextReference(references, item);
  return {
    references: upserted.references,
    result: {
      reference: item,
      evicted: upserted.evicted,
      diagnostics: [],
    },
  };
}

export function recordInteractiveContextReferences(
  references: readonly IContextReferenceItem[],
  records: readonly IPromptFileReferenceRecord[],
  options: { loadType: 'manual' | 'prompt-reference'; status: 'active' | 'observed' },
): IContextReferenceItem[] {
  if (records.length === 0) return [...references];
  const now = new Date().toISOString();
  let next = [...references];
  for (const record of records) {
    const item = createContextReferenceItem(record, options.loadType, options.status, now);
    next = upsertContextReference(next, item).references;
  }
  return next;
}

export function createSystemContextReferenceItems(
  entries: readonly IContextFileEntry[],
  cwd: string,
): IContextReferenceItem[] {
  const now = new Date().toISOString();
  return entries.map((entry) => {
    const entryPath = isAbsolutePath(entry.filePath)
      ? relativePath(cwd, entry.filePath)
      : entry.filePath;
    return {
      id: `system:${entryPath}`,
      sourcePath: entry.filePath,
      relativePath: entryPath,
      originalReference: entryPath,
      loadType: 'system' as const,
      status: 'active' as const,
      byteLength: utf8ByteLength(entry.content),
      loadedAt: now,
      lastUsedAt: now,
    };
  });
}
