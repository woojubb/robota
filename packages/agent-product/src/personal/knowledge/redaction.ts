/**
 * Finding forgotten text inside a host's own copies. A copy rarely holds a statement byte for byte:
 * a model may re-wrap it, change its case, or carry it inside a JSON-escaped tool argument. The
 * redactor therefore matches across case, any run of whitespace, and the JSON-escaped form, and
 * replaces only the matched span so the rest of the record stays as it was.
 */

/** What replaces a removed span. The wiki instructions tell the model never to guess or restore it. */
export const FORGOTTEN_MARKER = '[forgotten]';

const MIN_WORDS = 3;
const MIN_CHARACTERS = 16;

/**
 * Whether a text is distinctive enough to be searched in conversations other than its own: ordinary
 * short phrases ("tea", "Mina") would damage unrelated text everywhere.
 */
export function isSpecificText(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/u).filter((word) => word !== '').length;
  return words >= MIN_WORDS || trimmed.length >= MIN_CHARACTERS;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Scripts where letters glued to a statement do not make it part of a different word: they are
 * written without word spaces (Han, kana, Thai, Lao, Khmer, Myanmar), or attach endings and
 * particles to the last word (Hangul: a statement ending in a verb is quoted back with a quotative
 * * ending attached, and a name takes a topic particle). A boundary there would leave word-for-word
 * copies in place, so an edge in these scripts matches the literal span whatever its neighbour is.
 * The same holds for the neighbour: a Latin or numeric edge ("010-1234-5678", a product name) is
 * still found with such a particle attached, so only a neighbour outside these scripts counts as
 * continuing the word. The extra matching is bounded by `isSpecificText`: a short statement is only
 * searched in its own conversation.
 */
const NO_EDGE_CLASS =
  '[\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}]';
const NO_EDGE_BOUNDARY = new RegExp(NO_EDGE_CLASS, 'u');

/** A word character that is not in a no-boundary script: what makes a match part of a longer word. */
const CONTINUES_WORD = `(?!${NO_EDGE_CLASS})[\\p{L}\\p{N}]`;

function needsBoundary(edge: string): boolean {
  return WORD_CHARACTER.test(edge) && !NO_EDGE_BOUNDARY.test(edge);
}

/** One alternative: the words joined by any whitespace, bounded so it never cuts into a longer word. */
function alternative(text: string): string | undefined {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  if (words.length === 0) return undefined;
  const body = words.map(escapeRegExp).join('\\s+');
  const first = words[0]!;
  const last = words[words.length - 1]!;
  const firstCharacter = Array.from(first)[0]!;
  const lastCharacter = Array.from(last).at(-1)!;
  const before = needsBoundary(firstCharacter) ? `(?<!${CONTINUES_WORD})` : '';
  const after = needsBoundary(lastCharacter) ? `(?!${CONTINUES_WORD})` : '';
  return `${before}${body}${after}`;
}

/**
 * A function that replaces every occurrence of any of the texts with the forgotten marker. It matches
 * case-insensitively, lets any whitespace run stand for any other, also finds the JSON-escaped form
 * of a text, and does not match inside a longer word ("Mina" is not found in "Minasian").
 */
export function createForgottenTextRedactor(texts: readonly string[]): (value: string) => string {
  const forms = new Set<string>();
  for (const text of texts) {
    const trimmed = text.trim();
    if (trimmed === '') continue;
    forms.add(trimmed);
    const escaped = JSON.stringify(trimmed).slice(1, -1);
    if (escaped !== trimmed) forms.add(escaped);
  }
  const alternatives = [...forms]
    .sort((a, b) => b.length - a.length)
    .map(alternative)
    .filter((value): value is string => value !== undefined);
  if (alternatives.length === 0) return (value) => value;
  const pattern = new RegExp(alternatives.join('|'), 'giu');
  return (value) => value.replace(pattern, FORGOTTEN_MARKER);
}
