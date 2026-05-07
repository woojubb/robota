import { randomUUID } from 'node:crypto';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IPromptFileReferenceDiagnostic,
  IPromptFileReferenceHistoryData,
  IPromptFileReferenceRecord,
  IResolvedPromptFileReference,
} from './prompt-file-reference-types.js';

export function buildPromptWithFileReferences(
  input: string,
  references: readonly IResolvedPromptFileReference[],
): string {
  if (references.length === 0) return input;

  const blocks = references.map((reference) => {
    const content = reference.content.replaceAll('</file>', '<\\/file>');
    return [
      `<file path="${escapeAttribute(reference.relativePath)}" bytes="${reference.byteLength}" reason="${reference.reason}">`,
      content,
      '</file>',
    ].join('\n');
  });

  return [input, '<robota_file_references>', ...blocks, '</robota_file_references>'].join('\n\n');
}

export function hasBlockingPromptFileReferenceDiagnostics(
  diagnostics: readonly IPromptFileReferenceDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatPromptFileReferenceDiagnostics(
  diagnostics: readonly IPromptFileReferenceDiagnostic[],
): string {
  if (diagnostics.length === 0) return '';
  return [
    'File reference error:',
    ...diagnostics.map((diagnostic) => `- ${diagnostic.reference}: ${diagnostic.message}`),
  ].join('\n');
}

export function toPromptFileReferenceRecords(
  references: readonly IResolvedPromptFileReference[],
): IPromptFileReferenceRecord[] {
  return references.map(({ content: _content, ...record }) => record);
}

export function createPromptFileReferenceHistoryEntry(
  references: readonly IResolvedPromptFileReference[],
): IHistoryEntry<IPromptFileReferenceHistoryData> {
  const records = toPromptFileReferenceRecords(references);
  return {
    id: `prompt_file_reference_${randomUUID()}`,
    timestamp: new Date(),
    category: 'event',
    type: 'prompt-file-reference',
    data: {
      message: formatLoadedPromptFileReferencesMessage(records),
      references: records,
    },
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatLoadedPromptFileReferencesMessage(
  references: readonly IPromptFileReferenceRecord[],
): string {
  const list = references
    .map((reference) => `${reference.relativePath} (${reference.byteLength} B)`)
    .join(', ');
  return `Loaded file references: ${list}`;
}
