const PASTE_LABEL_RE = /\[Pasted text #(\d+) \+\d+ lines\]/g;

/**
 * Replace paste label placeholders with their original content from the store.
 * Labels that have no matching store entry are replaced with empty string.
 */
export function expandPasteLabels(text: string, store: Map<number, string>): string {
  return text.replace(PASTE_LABEL_RE, (_, id: string) => store.get(Number(id)) ?? '');
}
