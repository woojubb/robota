/**
 * #3186 — what the composer's `/` menu offers for a draft. Pure, so the matching is testable without
 * rendering: the TUI's autocomplete offers commands and skills the same way.
 *
 * #3282 §4e: a command the GUI cannot run at all (`isExcludedCommand`) never appears here — there is
 * nothing useful for choosing it to do, and typing it by hand is answered separately (see
 * `excluded-commands.ts`, `useSessionClient.ts`). Commands are listed before skills, each in its own
 * group, so the menu can head them "Commands" and "Skills".
 */

import { isExcludedCommand } from './excluded-commands.js';

import type { TCommandCatalog } from './session-client-types.js';

export interface ICommandMenuItem {
  readonly name: string;
  readonly description: string;
  readonly kind: 'command' | 'skill';
}

/** How many rows the menu shows before it scrolls — a CSS sizing constant, not a data limit. */
export const COMMAND_MENU_VISIBLE_ROWS = 8;

/** A generous ceiling on total matches, so a huge personal skill folder can never make the menu unusable. */
const COMMAND_MENU_MAX_MATCHES = 200;

/**
 * The menu for a draft, or null when no menu applies: the draft is not a bare `/name` being typed
 * (it has arguments, or does not start with `/`), or nothing matches. Within each group (commands,
 * then skills), names that start with what was typed come first, then names that merely contain it.
 */
export function commandMenuFor(
  catalog: TCommandCatalog | null,
  draft: string,
): readonly ICommandMenuItem[] | null {
  if (!catalog || !draft.startsWith('/') || /\s/u.test(draft)) return null;
  const query = draft.slice(1).toLowerCase();
  const commandItems: ICommandMenuItem[] = catalog.commands
    .filter((c) => !isExcludedCommand(c))
    .map((c) => ({ name: c.name, description: c.description, kind: 'command' as const }));
  const skillItems: ICommandMenuItem[] = catalog.skills
    .filter((s) => s.userInvocable)
    .map((s) => ({ name: s.name, description: s.description, kind: 'skill' as const }));
  const matched = [...matchGroup(commandItems, query), ...matchGroup(skillItems, query)].slice(
    0,
    COMMAND_MENU_MAX_MATCHES,
  );
  return matched.length > 0 ? matched : null;
}

/** One group's matches: names starting with the query, then names merely containing it, each alphabetical. */
function matchGroup(
  items: readonly ICommandMenuItem[],
  query: string,
): readonly ICommandMenuItem[] {
  const starts = items.filter((i) => i.name.toLowerCase().startsWith(query));
  const contains = items.filter(
    (i) => !i.name.toLowerCase().startsWith(query) && i.name.toLowerCase().includes(query),
  );
  return [...starts.sort(byName), ...contains.sort(byName)];
}

function byName(a: ICommandMenuItem, b: ICommandMenuItem): number {
  return a.name.localeCompare(b.name);
}
