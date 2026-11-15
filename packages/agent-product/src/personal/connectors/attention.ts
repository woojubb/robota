/**
 * The attention policy of a connector: what deserves a question to the person, written in plain words
 * the person can read and change. A connector kind has a sensible default; the person's own text, when
 * they wrote one, replaces it.
 */
import type { IConnector, TConnectorKind } from './types.js';

/** The longest attention text kept: one short paragraph. */
export const ATTENTION_MAX_CHARACTERS = 600;

const MAIL_ATTENTION =
  'Ask me about security notices (new sign-ins, password or recovery changes), bills and payments that are due, and messages from people already in my library. Do not ask me about newsletters, promotions or receipts.';

const GENERIC_ATTENTION =
  'Ask me about anything that needs my decision soon or looks unusual; do not ask me about routine updates.';

/** What a connector of this kind asks about until the person words it themselves. */
export function defaultAttention(kind: TConnectorKind): string {
  return kind === 'mail' ? MAIL_ATTENTION : GENERIC_ATTENTION;
}

/**
 * The words a sync run is given: the person's own text, or the default for the connector's kind. A
 * stored text that cannot be used as written (a hand-edited or damaged file) is normalised the way a
 * saved one is, and an unusable one falls back to the default rather than guessing at it.
 */
export function effectiveAttention(connector: IConnector): string {
  const stored: unknown = connector.attention;
  if (typeof stored !== 'string') return defaultAttention(connector.kind);
  const words = stored.replace(/\s+/gu, ' ').trim().slice(0, ATTENTION_MAX_CHARACTERS);
  return words === '' ? defaultAttention(connector.kind) : words;
}
