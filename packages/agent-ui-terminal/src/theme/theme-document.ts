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
      error: `${path}: "${override}" is not a colour in Ink's grammar (${THEME_COLOR_GRAMMAR})`,
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
      return { ok: false, error: `${path}.${key} is not a theme token` };
    }
    const result = mergeNode(base[key] ?? null, override[key] ?? null, `${path}.${key}`);
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
    return { ok: false, error: `$: ${cause instanceof Error ? cause.message : 'invalid JSON'}` };
  }
  if (!isJsonRecord(parsed)) return { ok: false, error: '$: expected an object' };
  for (const key of Object.keys(parsed)) {
    if (!DOCUMENT_KEYS.has(key)) return { ok: false, error: `$.${key} is not a theme token` };
  }
  return { ok: true, value: parsed };
}

function readName(document: IJsonRecord, fallback: string): TMergeResult {
  const name = document.name;
  if (name === undefined) return { ok: true, value: fallback };
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, error: '$.name: expected a non-empty string' };
  }
  return { ok: true, value: name };
}

function readBase(
  document: IJsonRecord,
):
  | { readonly ok: true; readonly theme: ITuiTheme }
  | { readonly ok: false; readonly error: string } {
  const id = document.base ?? DEFAULT_THEME_ID;
  if (typeof id !== 'string') return { ok: false, error: '$.base: expected a built-in theme id' };
  const base = BUILT_IN_THEMES.find((theme) => theme.id === id);
  if (!base) return { ok: false, error: `$.base: "${id}" is not a built-in theme` };
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

  const overrides = fields.overrides ?? {};
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
