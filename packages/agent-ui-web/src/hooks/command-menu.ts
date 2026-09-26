/**
 * #3186 — what the composer's `/` menu offers for a draft. Pure, so the matching is testable without
 * rendering: the TUI's autocomplete offers commands and skills the same way.
 */

import type { TCommandCatalog } from './session-client-types.js';

export interface ICommandMenuItem {
  readonly name: string;
  readonly description: string;
  readonly kind: 'command' | 'skill';
}

/** How many rows the menu shows; the rest are one more keystroke away. */
export const COMMAND_MENU_LIMIT = 8;

/**
 * The menu for a draft, or null when no menu applies: the draft is not a bare `/name` being typed
 * (it has arguments, or does not start with `/`), or nothing matches. Names that start with what was
 * typed come first, then names that merely contain it.
 */
export function commandMenuFor(
  catalog: TCommandCatalog | null,
  draft: string,
): readonly ICommandMenuItem[] | null {
  if (!catalog || !draft.startsWith('/') || /\s/u.test(draft)) return null;
  const query = draft.slice(1).toLowerCase();
  const items: ICommandMenuItem[] = [
    ...catalog.commands.map((c) => ({ name: c.name, description: c.description, kind: 'command' as const })),
    ...catalog.skills
      .filter((s) => s.userInvocable)
      .map((s) => ({ name: s.name, description: s.description, kind: 'skill' as const })),
  ];
  const starts = items.filter((i) => i.name.toLowerCase().startsWith(query));
  const contains = items.filter(
    (i) => !i.name.toLowerCase().startsWith(query) && i.name.toLowerCase().includes(query),
  );
  const matched = [...starts.sort(byName), ...contains.sort(byName)].slice(0, COMMAND_MENU_LIMIT);
  return matched.length > 0 ? matched : null;
}

function byName(a: ICommandMenuItem, b: ICommandMenuItem): number {
  return a.name.localeCompare(b.name);
}
