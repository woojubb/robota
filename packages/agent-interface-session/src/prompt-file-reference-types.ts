/**
 * Leaf type module for {@link IPromptFileReferenceRecord}.
 *
 * Split out of `event-contracts.ts` so `turn-contracts.ts` can depend on this type without
 * importing the whole of `event-contracts.ts` (which imports from `session-contracts.ts`, which in
 * turn imports from `turn-contracts.ts`) — that previously created an import cycle.
 */
export type TPromptFileReferenceReason = 'manual' | 'prompt-reference';

export interface IPromptFileReferenceRecord {
  originalReference: string;
  sourcePath: string;
  relativePath: string;
  reason: TPromptFileReferenceReason;
  depth: number;
  byteLength: number;
}
