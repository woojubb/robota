/**
 * CLI-2004 — the screen-reader label vocabulary (SSOT).
 *
 * A screen reader has no equivalent of `aria-live`: the only channel to it is which characters land
 * in the terminal buffer, in what order. A searchable prefix on every transcript line is therefore
 * the whole of the "who is speaking" affordance, and it has to be stable enough to grep for.
 *
 * PROVIDER-INVARIANT BY CONSTRUCTION. The label derives from the message ROLE, never from the
 * vendor behind it — `assistant:`, not the provider's product name — so the transcript reads
 * identically under every `agent-provider-*`. `screenReaderLabelValues()` exists so a test can
 * assert that negative mechanically instead of trusting review.
 *
 * All nine are lowercase. The reference this vocabulary is modelled on Title-Cases two of its nine;
 * that split is not reproduced, because a reader announces case and the inconsistency is noise.
 */

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** The nine label kinds. */
export type TScreenReaderLabelKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'toolError'
  | 'error'
  | 'warning'
  | 'permissionRequired'
  | 'cost';

/** The label vocabulary. Every spoken prefix in the mode comes from exactly this map. */
export const SCREEN_READER_LABELS: Readonly<Record<TScreenReaderLabelKind, string>> = {
  user: 'you:',
  assistant: 'assistant:',
  thinking: 'thinking:',
  tool: 'tool:',
  toolError: 'tool error:',
  error: 'error:',
  warning: 'warning:',
  permissionRequired: 'permission required:',
  cost: 'cost:',
};

/** Every label value, for mechanical assertions over the vocabulary. */
export function screenReaderLabelValues(): readonly string[] {
  return Object.values(SCREEN_READER_LABELS);
}

/**
 * Map a transcript message role onto the vocabulary. `system` speaks as `warning:` — it is the role
 * the TUI already renders in the warning colour, and the mode may not lean on colour.
 */
export function screenReaderLabelForRole(role: TUniversalMessage['role']): string {
  switch (role) {
    case 'user':
      return SCREEN_READER_LABELS.user;
    case 'assistant':
      return SCREEN_READER_LABELS.assistant;
    case 'tool':
      return SCREEN_READER_LABELS.tool;
    case 'system':
      return SCREEN_READER_LABELS.warning;
  }
}
