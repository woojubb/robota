/**
 * Key-hint footer SSOT (SCREEN-005).
 *
 * Single source of truth for prompt-footer key hints and the selection-row indicator across the
 * package's Ink prompt/selection components. Every footer call site declares its hints as
 * `IKeyHint[]` and renders them through `formatKeyHints` / `KeyHintFooter`, so exactly one grammar
 * exists (no per-component footer dialects) and a drift cannot re-appear silently — the
 * `key-hint-consistency` test asserts every declared hint set round-trips through this module.
 *
 * This module ships MECHANICS only: the separator, the pair grammar, the indicator constants.
 * Verb vocabulary (Navigate/Select/Confirm/…) is supplied by callers — the package stays a
 * content-neutral library ingredient. No config surface: per-call-site suppression is passing an
 * empty hint list.
 *
 * Affordance contract (see docs/SPEC.md "Interaction affordance contract"): the footer lists
 * exactly the keys that do something — a prompt that suppresses Esc in its flow omits Esc here.
 */

import { Text } from 'ink';
import React from 'react';

/** One key hint: the key(s) and the verb label, e.g. `{ keys: '↑↓', label: 'Navigate' }`. */
export interface IKeyHint {
  keys: string;
  label: string;
}

/** Separator between key-hint pairs. Changing the footer separator is a one-constant edit. */
export const KEY_HINT_SEPARATOR = ' · ';

/** Selection cursor rendered in front of the focused row. */
export const SELECTION_INDICATOR = '> ';

/** Same-width blank rendered in front of non-focused rows so columns stay aligned. */
export const SELECTION_INDICATOR_NONE = '  ';

/** Pure formatter: joins `keys label` pairs with {@link KEY_HINT_SEPARATOR}. Empty list → ''. */
export function formatKeyHints(hints: readonly IKeyHint[]): string {
  return hints.map((hint) => `${hint.keys} ${hint.label}`).join(KEY_HINT_SEPARATOR);
}

/**
 * Dim one-line footer: leading pad + formatted hints. Renders nothing for an empty hint list
 * (per-call-site suppression without a config surface).
 */
export function KeyHintFooter({
  hints,
}: {
  hints: readonly IKeyHint[];
}): React.ReactElement | null {
  if (hints.length === 0) return null;
  return <Text dimColor> {formatKeyHints(hints)}</Text>;
}
