/**
 * Leaf type module for the CJK text-input flow state and effect union.
 *
 * Split out of `cjk-text-input-flow.ts` so `cjk-cursor-motion.ts` can depend on these types
 * without importing back from `cjk-text-input-flow.ts`, which previously created an import cycle
 * between the two (`cjk-cursor-motion.ts` -> `cjk-text-input-flow.ts` -> `cjk-cursor-motion.ts`).
 */

export interface ICjkTextInputFlowState {
  value: string;
  cursor: number;
  isPasting: boolean;
  pasteBuffer: string;
}

/** CLI-2004: a word/line delete is announced; a single-character backspace is not (it is heard). */
export type TCjkDeletionScope = 'word' | 'line';

export type TCjkTextInputEffect =
  | { type: 'none' }
  | { type: 'change'; value: string; deleted?: string; deletedScope?: TCjkDeletionScope }
  | { type: 'submit'; value: string }
  | { type: 'paste'; text: string; cursor: number }
  | { type: 'render' };
