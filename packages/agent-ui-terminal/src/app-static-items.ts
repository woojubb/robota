/**
 * SCREEN-010 / CLI-2004 — what gets committed to the terminal's native scrollback.
 *
 * The App renders exactly this list inside a single Ink `<Static>`, so each item is written once and
 * never repainted. Building the list is a pure function so the ONE decision that varies — whether
 * the startup banner is committed at all — is assertable without mounting the App.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';

/** A committed item: the startup banner, or one conversation entry. */
export type TStaticItem =
  | { readonly kind: 'banner'; readonly version: string }
  | { readonly kind: 'entry'; readonly entry: IHistoryEntry };

export interface IBuildStaticItemsInputs {
  history: readonly IHistoryEntry[];
  version: string | undefined;
  /**
   * Screen-reader mode. The banner is ASCII art with no spoken meaning — a reader announces it
   * character by character before the session has said anything — so the mode omits the item
   * entirely rather than styling it differently.
   */
  screenReader: boolean;
}

const FALLBACK_VERSION = '0.0.0';

/** Build the `<Static>` item list. */
export function buildStaticItems(inputs: IBuildStaticItemsInputs): TStaticItem[] {
  const banner: TStaticItem[] = inputs.screenReader
    ? []
    : [{ kind: 'banner', version: inputs.version ?? FALLBACK_VERSION }];
  return [...banner, ...inputs.history.map((entry): TStaticItem => ({ kind: 'entry', entry }))];
}
