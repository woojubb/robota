/**
 * #3282 §4e — built-in commands left out of the GUI on purpose (the design decisions in
 * `packages/agent-gui-web/docs/SPEC.md` group them by reason). The `/` menu never lists one of these
 * (`command-menu.ts`), and typing one by hand anyway is caught before it reaches the session
 * (`useSessionClient.ts`'s `send`) and answered with the plain sentence here — never the session's own
 * refusal, and never the generic "not available on this surface" line CMD-004 uses for a screen this
 * surface simply has not built yet (see `ui-intent-state.ts`).
 */

import type { TCommandRunner, TCommandSurface } from '@robota-sdk/agent-interface-command';

/** The minimum a catalog entry needs for the exclusion check below. */
export interface IExcludableCommandEntry {
  readonly name: string;
  readonly runner?: TCommandRunner;
  readonly surfaces?: readonly TCommandSurface[];
}

/**
 * One plain sentence per excluded command, naming what to use instead — never the command's own
 * name again, never "not available on this surface". `theme`, `keybindings`, `editor` and `shell`
 * also declare `runner: 'client', surfaces: ['terminal']` server-side (a second, independent way to
 * reach the same "excluded" answer, checked by {@link isExcludedCommand} below); `statusline`,
 * `exit` and `devices` do not, and are excluded here only because the GUI has its own, better answer.
 */
const EXCLUDED_COMMAND_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['theme', 'Robota follows your system appearance.'],
  ['keybindings', 'Robota uses standard keyboard shortcuts here.'],
  ['editor', 'Type your message directly in the composer.'],
  ['statusline', 'The GUI shows session status in its own status row, not a terminal status line.'],
  ['shell', 'Use the Terminal app for shell commands.'],
  ['exit', 'Close the window or tab to end this session; delete it from the sidebar to remove it for good.'],
  ['devices', 'Device pairing is managed from the terminal for now.'],
]);

/** A terminal-client command with no curated sentence above still gets a plain, honest one. */
const GENERIC_CLIENT_MESSAGE = 'This command runs in the robota terminal.';

/**
 * Whether a catalog entry is left out of the GUI: named above, or declared `runner: 'client'` for
 * surfaces that do not include `'gui'` (a client-only command the GUI cannot run itself, whether or
 * not this file has a curated sentence for it yet).
 */
export function isExcludedCommand(entry: IExcludableCommandEntry): boolean {
  if (EXCLUDED_COMMAND_MESSAGES.has(entry.name)) return true;
  return entry.runner === 'client' && !(entry.surfaces ?? []).includes('gui');
}

/** The plain sentence for an excluded command name — a safe generic one when none is curated. */
export function excludedCommandMessage(name: string): string {
  return EXCLUDED_COMMAND_MESSAGES.get(name) ?? GENERIC_CLIENT_MESSAGE;
}
