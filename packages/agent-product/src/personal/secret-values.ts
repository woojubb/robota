/**
 * The secret check for text a person or the agent writes in plain words: an attention policy, a case.
 * Such text is written in the vocabulary of secrets ("password", "token", "key": a sign-in notice is
 * the usual example), so it is judged by the value it carries, not by those words.
 */
import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

/**
 * Longer than any plain word and shorter than every value the secret check recognises by its shape (a
 * credential prefix with its body, a key block, a long mixed run), so a word this short that the check
 * flags is flagged by its vocabulary alone.
 */
const VOCABULARY_MAX_LENGTH = 16;
/** A word, or the phrase "private key", with a `:` or `=` and the first character of a value after it. */
const WORD_AND_VALUE = /(private key|[\p{L}\p{M}_-]+)(\s*[:=]\s*\S)?/giu;
/** Shapes the secret check knows only through the words that usually precede them. */
const KEY_BLOCK = /-----BEGIN [A-Z ]*-----/u;
const NATIONAL_ID_NUMBER = /\b\d{6}-[1-8]\d{6}\b/u;

/**
 * Whether a text carries a secret value. A word the shared secret check flags by its vocabulary alone,
 * in any language it knows, is set aside before the check looks at what remains, which still refuses
 * credential prefixes, key blocks, tokens and card or identity numbers by their shape. A set-aside word
 * followed by `:` or `=` and a value is a secret written out, so that is refused as well.
 *
 * Accepted residual risk: a short, low-entropy value written as plain prose ("my password is hunter2")
 * has no shape to recognise and is not refused. The realistic accidental pastes (keys, tokens, card and
 * identity numbers) are.
 */
export function carriesSecretValue(text: string): boolean {
  let assigned = false;
  const rest = text.replace(WORD_AND_VALUE, (match, word: string, value: string | undefined) => {
    if (word.length >= VOCABULARY_MAX_LENGTH || !containsSensitiveMemoryContent(word)) return match;
    if (value !== undefined) assigned = true;
    return ' ';
  });
  return (
    assigned ||
    KEY_BLOCK.test(text) ||
    NATIONAL_ID_NUMBER.test(text) ||
    containsSensitiveMemoryContent(rest)
  );
}
