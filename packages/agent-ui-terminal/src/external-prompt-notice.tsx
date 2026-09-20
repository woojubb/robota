/**
 * FLOW-2006: the line that says a prompt did not come from the person at the keyboard.
 *
 * A deep link can fill the composer, so the provenance has to be visible until the text is sent or
 * cleared — otherwise a prompt the user never typed reads exactly like one they did. Above the long
 * threshold it also carries the character count and says to read the whole thing, because a long
 * prompt pushes its own instructions off screen.
 */
import React from 'react';

import { Text } from './SafeText.js';

/** Above this many characters the notice escalates from a label to a review instruction. */
export const EXTERNAL_PROMPT_REVIEW_THRESHOLD = 1000;
export const EXTERNAL_PROMPT_NOTICE = 'Prompt from an external link';

export interface IExternalPromptNoticeProps {
  /** The composer's current text, so the notice can size its warning to what is actually there. */
  readonly value: string;
}

/** The notice text for a value, or `undefined` when there is nothing to say. */
export function externalPromptNotice(value: string): string | undefined {
  if (value.length === 0) return undefined;
  return value.length > EXTERNAL_PROMPT_REVIEW_THRESHOLD
    ? `${EXTERNAL_PROMPT_NOTICE} — ${value.length} characters; scroll and review the full text before sending`
    : EXTERNAL_PROMPT_NOTICE;
}

export default function ExternalPromptNotice({
  value,
}: IExternalPromptNoticeProps): React.ReactElement | null {
  const notice = externalPromptNotice(value);
  if (notice === undefined) return null;
  return <Text dimColor>{notice}</Text>;
}
