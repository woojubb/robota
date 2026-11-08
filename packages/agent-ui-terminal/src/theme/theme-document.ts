/**
 * SCREEN-2002 — the theme file boundary.
 *
 * A theme file is `{ name?, base?, overrides? }`: a name, a built-in to start from, and a SPARSE map
 * over the same token paths the built-ins use. It is refused WHOLE on the first unknown token or
 * invalid value, with a `$.`-path naming what was wrong — the keybindings document's contract, for
 * the same reason. A partially-applied theme is the state where a reader cannot tell which colours
 * are theirs and which the base's, and a file that silently loses its third line is worse than a
 * file that is skipped with its reason printed.
 *
 * The token paths are not listed here. They are WALKED from the base theme, so `ITuiTheme` gaining a
 * key makes it overridable and `ITuiTheme` losing one makes it refused — there is no second
 * declaration of the token model to drift from the first.
 *
 * Values go through `isThemeColor`, which is also the injection floor: a raw escape sequence is not
 * in Ink's grammar, so it cannot enter through a theme.
 */
import { isJsonRecord } from '../json-value.js';
import { sanitizeTerminalText } from '../sanitize-terminal-text.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from './built-in-themes.js';
import { isThemeColor, THEME_COLOR_GRAMMAR } from './theme-styles.js';

import type { IJsonRecord, TJsonValue } from '../json-value.js';
import type { ITuiTheme, TThemeSource } from './theme-contracts.js';

export interface IThemeDocumentInput {
  /** The namespaced id the caller minted — `custom:<slug>` or `custom:<plugin>:<slug>`. */
  readonly id: string;
  /** The file's own name, for the `Skipped theme "<file>": …` line. */
  readonly fileName: string;
  readonly source: TThemeSource;
  readonly text: string;
}

export type TThemeDocumentResult =
  { readonly ok: true; readonly theme: ITuiTheme } | { readonly ok: false; readonly error: string };

const DOCUMENT_KEYS = new Set(['name', 'base', 'overrides']);
const MAX_NAME_LENGTH = 60;
// eslint-disable-next-line no-control-regex -- matching the control range IS the point here
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u;

const CONTROL_CHARACTERS = new RegExp(CONTROL_CHARACTER.source, 'gu');

/**
 * Untrusted text on its way into a line a terminal will print — the one escaping policy, exported
 * so the surfaces that build their OWN diagnostics use it rather than re-deriving it.
 *
 * A diagnostic is the one part of a refused file that reaches the terminal, and it quotes what was
 * wrong — so without this the injection floor the grammar provides is defeated by the message that
 * reports a violation of it. Escaped rather than stripped, because an author has to SEE what their
 * file contains (`"\u001b[31m"`) instead of a value that looks fine.
 *
 * `JSON.stringify` alone is NOT enough, and that is the whole reason this is a function: it escapes
 * U+0000–U+001F and leaves U+007F and the C1 range literal — including U+009B and U+009D, the
 * single-byte spellings of CSI and OSC. A terminal accepts both spellings (`sanitize-terminal-text.ts`
 * says so and handles both), so quoting only the 7-bit one leaves the 8-bit one's parameters
 * standing as a live sequence.
 */
export function quoteThemeText(value: string): string {
  return JSON.stringify(value).replace(
    CONTROL_CHARACTERS,
    (character) => `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The same escaping WITHOUT the surrounding quotes, for a field a caller already quotes — so a
 * refused file does not print as `Skipped theme ""My Theme.json"": …`.
 */
export function escapeThemeText(value: string): string {
  return quoteThemeText(value).slice(1, -1);
}

/**
 * Prose a surface did not write — a dependency's message, a path from the environment. Sanitized
 * rather than quoted, because it is a sentence; `sanitizeTerminalText` removes both spellings of
 * every sequence, and the tab/newline it keeps are flattened so one diagnostic stays one line.
 */
export function sanitizeThemeProse(message: string): string {
  return sanitizeTerminalText(message).replaceAll('\n', ' ').replaceAll('\t', ' ').trim();
}

/** A path SEGMENT taken from the file. Plain keys read as themselves; anything else is quoted. */
function pathSegment(key: string): string {
  return CONTROL_CHARACTER.test(key) ? quoteThemeText(key) : key;
}

function refuse(error: string): TThemeDocumentResult {
  return { ok: false, error };
}

type TMergeResult =
  | { readonly ok: true; readonly value: TJsonValue }
  | { readonly ok: false; readonly error: string };

function mergeColor(override: TJsonValue, path: string): TMergeResult {
  if (typeof override !== 'string')
    return { ok: false, error: `${path}: expected a colour string` };
  if (!isThemeColor(override)) {
    return {
      ok: false,
      error: `${path}: ${quoteThemeText(override)} is not a colour in Ink's grammar (${THEME_COLOR_GRAMMAR})`,
    };
  }
  return { ok: true, value: override };
}

function mergeArray(base: readonly TJsonValue[], override: TJsonValue, path: string): TMergeResult {
  if (!Array.isArray(override) || override.length !== base.length) {
    return { ok: false, error: `${path}: expected exactly ${base.length} colours` };
  }
  const merged: TJsonValue[] = [];
  for (const [index, item] of base.entries()) {
    const result = mergeNode(item, override[index] ?? null, `${path}[${index}]`);
    if (!result.ok) return result;
    merged.push(result.value);
  }
  return { ok: true, value: merged };
}

function mergeRecord(base: IJsonRecord, override: TJsonValue, path: string): TMergeResult {
  if (!isJsonRecord(override)) return { ok: false, error: `${path}: expected an object of tokens` };
  const merged: IJsonRecord = { ...base };
  for (const key of Object.keys(override)) {
    // Own-property only: a JSON document can carry a literal `__proto__` key, and the base theme
    // has no own property by that name, so the same check that catches a typo catches that too.
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      return { ok: false, error: `${path}.${pathSegment(key)} is not a theme token` };
    }
    const result = mergeNode(
      base[key] ?? null,
      override[key] ?? null,
      `${path}.${pathSegment(key)}`,
    );
    if (!result.ok) return result;
    merged[key] = result.value;
  }
  return { ok: true, value: merged };
}

/** One node of the token tree, matched against the SHAPE of the base theme's node. */
function mergeNode(base: TJsonValue, override: TJsonValue, path: string): TMergeResult {
  if (typeof base === 'string') return mergeColor(override, path);
  if (Array.isArray(base)) return mergeArray(base, override, path);
  if (isJsonRecord(base)) return mergeRecord(base, override, path);
  return { ok: false, error: `${path} is not a theme token` };
}

type TThemeTokens = Pick<ITuiTheme, 'colors' | 'markdown' | 'syntax' | 'motion'>;

/**
 * The merged tree, read back as the token groups it was built from.
 *
 * A JSON round-trip rather than a type assertion, in both directions: the token interfaces have no
 * index signature, so neither shape is assignable to the other and an assertion between them is
 * what TypeScript rightly refuses. The conversion is sound by construction — `mergeNode` copies the
 * BASE theme's shape and replaces only string leaves with strings the grammar accepted, so every key
 * `ITuiTheme` declares is present and every leaf is a `TThemeColor`. An unknown key or a non-colour
 * leaf is a refusal above this line and never reaches it.
 */
function asThemeTokens(value: TJsonValue): TThemeTokens {
  return JSON.parse(JSON.stringify(value)) as TThemeTokens;
}

/** The four token groups, as JSON — the base for the walk above. */
function themeTokens(theme: ITuiTheme): IJsonRecord {
  return JSON.parse(
    JSON.stringify({
      colors: theme.colors,
      markdown: theme.markdown,
      syntax: theme.syntax,
      motion: theme.motion,
    }),
  ) as IJsonRecord;
}

function readDocument(text: string): TMergeResult {
  let parsed: TJsonValue;
  try {
    parsed = JSON.parse(text) as TJsonValue;
  } catch (cause) {
    return {
      ok: false,
      error: `$: ${cause instanceof Error ? sanitizeThemeProse(cause.message) : 'invalid JSON'}`,
    };
  }
  if (!isJsonRecord(parsed)) return { ok: false, error: '$: expected an object' };
  for (const key of Object.keys(parsed)) {
    if (!DOCUMENT_KEYS.has(key)) {
      return { ok: false, error: `$.${pathSegment(key)} is not a theme token` };
    }
  }
  return { ok: true, value: parsed };
}

function readName(document: IJsonRecord, fallback: string): TMergeResult {
  const name = document.name;
  // The FALLBACK is checked on the same terms. It is the id the loader minted, which is constrained
  // where it is minted — but "the caller already made it safe" is the assumption that put an
  // unchecked string on every list row once, and this is the function that renders the answer.
  if (name === undefined) {
    if (CONTROL_CHARACTER.test(fallback)) {
      return { ok: false, error: '$.name: the minted id must not contain control characters' };
    }
    if (fallback.length > MAX_NAME_LENGTH) {
      return {
        ok: false,
        error: `$.name: the minted id must be at most ${MAX_NAME_LENGTH} characters`,
      };
    }
    return { ok: true, value: fallback };
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, error: '$.name: expected a non-empty string' };
  }
  // A name is APPLIED, so unlike a diagnostic it is rendered on every `/theme list` row and every
  // picker row for the whole session. A control character there is an escape the terminal acts on,
  // and a newline breaks the box the row is drawn in — so the file is refused rather than the name
  // repaired, which is this module's one policy.
  if (CONTROL_CHARACTER.test(name)) {
    return { ok: false, error: '$.name: must not contain control characters' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `$.name: must be at most ${MAX_NAME_LENGTH} characters` };
  }
  return { ok: true, value: name };
}

function readBase(
  document: IJsonRecord,
):
  | { readonly ok: true; readonly theme: ITuiTheme }
  | { readonly ok: false; readonly error: string } {
  // `=== undefined`, not `??`: an explicit `null` is a value the file states, and "applied whole or
  // refused whole" means it is refused rather than silently read as "unset".
  const id = document.base === undefined ? DEFAULT_THEME_ID : document.base;
  if (typeof id !== 'string') return { ok: false, error: '$.base: expected a built-in theme id' };
  const base = BUILT_IN_THEMES.find((theme) => theme.id === id);
  if (!base) return { ok: false, error: `$.base: ${quoteThemeText(id)} is not a built-in theme` };
  return { ok: true, theme: base };
}

/**
 * Parse one theme file. The `id`, the `source` and the `appearance` are NOT the document's to
 * decide: the id is minted from where the file was found so nothing can shadow a built-in, the
 * source is where it was read from, and the appearance follows the base a theme chose to extend.
 */
export function parseThemeDocument(input: IThemeDocumentInput): TThemeDocumentResult {
  const document = readDocument(input.text);
  if (!document.ok) return refuse(document.error);
  const fields = document.value as IJsonRecord;

  const base = readBase(fields);
  if (!base.ok) return refuse(base.error);

  const name = readName(fields, input.id);
  if (!name.ok) return refuse(name.error);

  const overrides = fields.overrides === undefined ? {} : fields.overrides;
  const tokens = mergeNode(themeTokens(base.theme), overrides, '$.overrides');
  if (!tokens.ok) return refuse(tokens.error);

  const { colors, markdown, syntax, motion } = asThemeTokens(tokens.value);
  return {
    ok: true,
    theme: {
      id: input.id,
      name: name.value as string,
      appearance: base.theme.appearance,
      source: input.source,
      colors,
      markdown,
      syntax,
      motion,
    },
  };
}
