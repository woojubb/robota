/**
 * CLI-2004 — the numbered-list menu (SSOT for its grammar).
 *
 * Every arrow-key menu becomes this in screen-reader mode: `N. <option>` lines followed by one
 * prompt naming the valid range. Arrow navigation and the `> ` cursor are position cues a reader
 * cannot follow — a spoken "3" is unambiguous, and the range in the prompt is the affordance.
 *
 * The prompt LITERAL is authored here, not copied from any reference: the surveyed documentation
 * publishes the prompt's NAME and the cancel suffix, never the composed string. This module is the
 * one place it exists, so the menus cannot drift into per-component dialects — the same reason
 * `key-hint-footer.tsx` owns the footer grammar.
 *
 * No colour props: the mode drops colour rather than substituting values, so the palette floor stays
 * green and nothing here depends on a cue a reader cannot hear.
 */

import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';

/** Appended to the prompt when Escape actually cancels the menu. */
export const NUMBERED_LIST_CANCEL_SUFFIX = ' or Escape to cancel';

/** The prompt literal. `Enter selection (1-3)`, plus the cancel suffix where it applies. */
export function formatNumberedSelectionPrompt(itemCount: number, cancellable: boolean): string {
  const base = `Enter selection (1-${itemCount})`;
  return cancellable ? `${base}${NUMBERED_LIST_CANCEL_SUFFIX}` : base;
}

/** One row's number prefix: `1. `, `2. `, … */
export function numberedRowPrefix(index: number): string {
  return `${index + 1}. `;
}

export interface INumberedListProps {
  /** Heading line, e.g. the menu title or the permission question. */
  title?: string;
  /** Extra context line under the title. */
  description?: string;
  /** The selectable options, in order. */
  options: readonly string[];
  /** Escape cancels ⇒ the prompt says so. */
  cancellable?: boolean;
  /** Digits typed so far, echoed after the prompt. */
  buffer?: string;
  /** The last entry was out of range ⇒ the same literal is re-printed. */
  invalid?: boolean;
}

/** Render the numbered list and its prompt. */
export function NumberedList({
  title,
  description,
  options,
  cancellable = false,
  buffer = '',
  invalid = false,
}: INumberedListProps): React.ReactElement {
  const prompt = formatNumberedSelectionPrompt(options.length, cancellable);
  return (
    <Box flexDirection="column">
      {title !== undefined && title.length > 0 && <Text>{title}</Text>}
      {description !== undefined && description.length > 0 && <Text>{description}</Text>}
      {options.map((option, index) => (
        <Text key={`${index}-${option}`}>
          {numberedRowPrefix(index)}
          {option}
        </Text>
      ))}
      <Text>
        {prompt}
        {buffer.length > 0 ? ` ${buffer}` : ''}
      </Text>
      {/* An out-of-range answer re-prints the SAME literal: the range is the correction. */}
      {invalid && <Text>{prompt}</Text>}
    </Box>
  );
}
