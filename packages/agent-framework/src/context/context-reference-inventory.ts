import type { IPromptFileReferenceRecord } from './prompt-file-reference-types.js';

export type TContextReferenceLoadType = 'manual' | 'prompt-reference';
export type TContextReferenceStatus = 'active' | 'observed';

export interface IContextReferenceItem {
  id: string;
  sourcePath: string;
  relativePath: string;
  originalReference: string;
  loadType: TContextReferenceLoadType;
  status: TContextReferenceStatus;
  byteLength: number;
  loadedAt: string;
  lastUsedAt?: string;
}

export interface IContextReferenceInventoryLimits {
  maxActiveReferences?: number;
  maxActiveBytes?: number;
  maxObservedReferences?: number;
}

export interface IContextReferenceAddResult {
  reference?: IContextReferenceItem;
  evicted: IContextReferenceItem[];
  diagnostics: string[];
}

export interface IContextReferenceRemoveResult {
  removed?: IContextReferenceItem;
}

export interface IContextReferenceClearResult {
  removed: IContextReferenceItem[];
}

export interface IContextReferenceUpsertResult {
  references: IContextReferenceItem[];
  evicted: IContextReferenceItem[];
}

const DEFAULT_MAX_ACTIVE_REFERENCES = Number('8');
const BYTES_PER_KIB = Number('1024');
const DEFAULT_MAX_ACTIVE_BYTES = Number('256') * BYTES_PER_KIB;
const DEFAULT_MAX_OBSERVED_REFERENCES = Number('32');

export function createContextReferenceItem(
  record: IPromptFileReferenceRecord,
  loadType: TContextReferenceLoadType,
  status: TContextReferenceStatus,
  timestamp = new Date().toISOString(),
): IContextReferenceItem {
  return {
    id: `${loadType}:${record.relativePath}`,
    sourcePath: record.sourcePath,
    relativePath: record.relativePath,
    originalReference: record.originalReference,
    loadType,
    status,
    byteLength: record.byteLength,
    loadedAt: timestamp,
    lastUsedAt: timestamp,
  };
}

export function upsertContextReference(
  references: readonly IContextReferenceItem[],
  item: IContextReferenceItem,
  limits?: IContextReferenceInventoryLimits,
): IContextReferenceUpsertResult {
  const existing = references.find((reference) => reference.sourcePath === item.sourcePath);
  const retained = references.filter((reference) => reference.sourcePath !== item.sourcePath);
  const nextItem = existing ? mergeContextReference(existing, item) : item;
  return enforceContextReferenceLimits([...retained, nextItem], limits);
}

export function removeContextReference(
  references: readonly IContextReferenceItem[],
  query: string,
): { references: IContextReferenceItem[]; result: IContextReferenceRemoveResult } {
  const normalized = normalizeReferenceQuery(query);
  const removed = references.find((reference) => matchesContextReference(reference, normalized));
  if (!removed) return { references: [...references], result: {} };
  return {
    references: references.filter((reference) => reference.sourcePath !== removed.sourcePath),
    result: { removed },
  };
}

export function clearContextReferences(
  references: readonly IContextReferenceItem[],
): IContextReferenceClearResult {
  return { removed: [...references] };
}

export function listActiveContextReferences(
  references: readonly IContextReferenceItem[],
): IContextReferenceItem[] {
  return references.filter((reference) => reference.status === 'active');
}

export function toContextReferenceRecords(
  references: readonly IContextReferenceItem[],
): IPromptFileReferenceRecord[] {
  return references.map((reference) => ({
    originalReference: reference.originalReference,
    sourcePath: reference.sourcePath,
    relativePath: reference.relativePath,
    reason: reference.loadType,
    depth: 0,
    byteLength: reference.byteLength,
  }));
}

function mergeContextReference(
  existing: IContextReferenceItem,
  incoming: IContextReferenceItem,
): IContextReferenceItem {
  if (incoming.status === 'active') return { ...incoming, loadedAt: existing.loadedAt };
  return {
    ...existing,
    byteLength: incoming.byteLength,
    originalReference: incoming.originalReference,
    lastUsedAt: incoming.lastUsedAt,
  };
}

function enforceContextReferenceLimits(
  references: readonly IContextReferenceItem[],
  limits?: IContextReferenceInventoryLimits,
): IContextReferenceUpsertResult {
  const maxActiveReferences = limits?.maxActiveReferences ?? DEFAULT_MAX_ACTIVE_REFERENCES;
  const maxActiveBytes = limits?.maxActiveBytes ?? DEFAULT_MAX_ACTIVE_BYTES;
  const maxObservedReferences = limits?.maxObservedReferences ?? DEFAULT_MAX_OBSERVED_REFERENCES;
  const evicted: IContextReferenceItem[] = [];
  let next = [...references];

  while (
    countActiveReferences(next) > maxActiveReferences ||
    countActiveBytes(next) > maxActiveBytes
  ) {
    const candidate = next.find((reference) => reference.status === 'active');
    if (!candidate) break;
    evicted.push(candidate);
    next = next.filter((reference) => reference.sourcePath !== candidate.sourcePath);
  }

  const observed = next.filter((reference) => reference.status === 'observed');
  if (observed.length > maxObservedReferences) {
    const overflow = observed.slice(0, observed.length - maxObservedReferences);
    evicted.push(...overflow);
    next = next.filter(
      (reference) =>
        reference.status !== 'observed' ||
        !overflow.some((removed) => removed.sourcePath === reference.sourcePath),
    );
  }

  return { references: next, evicted };
}

function countActiveReferences(references: readonly IContextReferenceItem[]): number {
  return references.filter((reference) => reference.status === 'active').length;
}

function countActiveBytes(references: readonly IContextReferenceItem[]): number {
  return references.reduce(
    (total, reference) => total + (reference.status === 'active' ? reference.byteLength : 0),
    0,
  );
}

function normalizeReferenceQuery(query: string): string {
  return query.startsWith('@') ? query.slice(1) : query;
}

function matchesContextReference(reference: IContextReferenceItem, query: string): boolean {
  return (
    reference.relativePath === query ||
    reference.sourcePath === query ||
    reference.originalReference === query ||
    reference.originalReference === `@${query}`
  );
}
