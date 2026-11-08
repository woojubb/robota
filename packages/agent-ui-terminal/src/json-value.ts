/**
 * The shape of a parsed JSON document, and the one guard that narrows it.
 *
 * Two user-owned files are read as JSON in this package — the keybindings document and, since
 * SCREEN-2002, a theme document — and both walk an arbitrary tree looking for the keys they know.
 * A second copy of this type would be a second answer to "what can a parsed file hold", which is
 * how two readers of the same kind of file start disagreeing about what a null or an array means.
 */
export type TJsonValue = string | number | boolean | null | TJsonValue[] | IJsonRecord;

export interface IJsonRecord {
  [key: string]: TJsonValue;
}

/** An object, not an array and not `null` — the distinction `typeof` alone does not make. */
export function isJsonRecord(value: TJsonValue): value is IJsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
