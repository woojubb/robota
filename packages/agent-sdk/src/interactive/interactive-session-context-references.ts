import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import {
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  resolvePromptFileReferencePaths,
  toPromptFileReferenceRecords,
} from '../context/prompt-file-references.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceItem,
} from '../context/context-reference-inventory.js';
import {
  createContextReferenceItem,
  upsertContextReference,
} from '../context/context-reference-inventory.js';

export interface IAddInteractiveContextReferenceResult {
  references: IContextReferenceItem[];
  result: IContextReferenceAddResult;
}

export async function addInteractiveContextReference(
  references: readonly IContextReferenceItem[],
  path: string,
  cwd: string,
): Promise<IAddInteractiveContextReferenceResult> {
  const result = await resolvePromptFileReferencePaths([path], {
    cwd,
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
