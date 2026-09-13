/**
 * The input area's horizontal rules, and the deletion announcement that replaces them.
 *
 * Extracted from `InputArea.tsx` (CLI-2004). The rules are hand-drawn `<Text>` lines rather than a
 * Yoga-synthesized `Box` border because a synthesized border drops glyphs during rapid re-render at
 * full terminal height (SCREEN-003) — which is exactly why they are not covered by the `borderStyle`
 * suppression the mode applies elsewhere and need their own branch.
 */

import React from 'react';

import { Text } from './SafeText.js';
import { PALETTE } from './tui-palette.js';
import { buildInputTopBorder } from './utils/input-top-border.js';

/** The announcement's exact shape, so the input and its test cannot disagree about it. */
export function formatDeletionAnnouncement(deleted: string): string {
  return `[deleted: ${deleted}]`;
}

/** Top rule, carrying the optional right-aligned session title. Nothing in screen-reader mode. */
export function InputTopRule({
  screenReader,
  innerWidth,
  borderColor,
  sessionName,
}: {
  screenReader: boolean;
  innerWidth: number;
  borderColor: string;
  sessionName?: string;
}): React.ReactElement | null {
  if (screenReader) return null;
  const topBorder = buildInputTopBorder(innerWidth, sessionName);
  return (
    <Text color={borderColor}>
      {topBorder.left}
      {topBorder.label ? (
        <Text backgroundColor={borderColor} color={PALETTE.text.onAccent} bold>
          {topBorder.label}
        </Text>
      ) : null}
      {topBorder.right}
    </Text>
  );
}

/** Bottom rule (mirrors the top). Nothing in screen-reader mode. */
export function InputBottomRule({
  screenReader,
  innerWidth,
  borderColor,
}: {
  screenReader: boolean;
  innerWidth: number;
  borderColor: string;
}): React.ReactElement | null {
  if (screenReader) return null;
  return <Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>;
}

/** `[deleted: <text>]`, rendered once for the most recent word/line delete. */
export function DeletionAnnouncement({
  deleted,
}: {
  deleted: string | null;
}): React.ReactElement | null {
  if (deleted === null) return null;
  return <Text>{formatDeletionAnnouncement(deleted)}</Text>;
}
