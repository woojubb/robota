'use client';

import { X } from 'lucide-react';

import { commandMenuFor } from '../hooks/command-menu.js';
import { Dialog } from './Dialog.js';

import type { TCommandCatalog } from '../hooks/session-client-types.js';

/** One keyboard shortcut this surface answers — #3282 §4e. */
interface IShortcut {
  readonly keys: string;
  readonly description: string;
}

const SHORTCUTS: readonly IShortcut[] = [
  { keys: '⌘,', description: 'Open Settings' },
  { keys: 'Esc', description: 'Close a dialog or menu, or stop the current run' },
  { keys: 'Shift+Tab', description: 'Answer a pending question with the keyboard' },
  { keys: 'Enter', description: 'Send the message' },
  { keys: 'Shift+Enter', description: 'Start a new line' },
];

/**
 * The GUI's Help sheet (#3282 §4e), a `Dialog` opened by `/help` — client-only: `useSessionClient.ts`'s
 * `send` catches `/help` before it ever reaches the session and opens this instead, so there is no
 * round trip and nothing terminal-style to replace it with. It lists the same commands and skills the
 * `/` menu offers (`commandMenuFor`, unfiltered by any query — an excluded command has no row here
 * either, exactly like the menu), grouped the same way, plus the keyboard shortcuts this surface
 * answers. The TUI keeps its own text `/help` output; this sheet is the GUI's alone.
 */
export function HelpSheet({
  open,
  onClose,
  catalog,
}: {
  open: boolean;
  onClose: () => void;
  catalog: TCommandCatalog | null;
}): React.ReactElement | null {
  const items = commandMenuFor(catalog, '/') ?? [];
  const commands = items.filter((item) => item.kind === 'command');
  const skills = items.filter((item) => item.kind === 'skill');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Help"
      panelClassName="flex h-[min(600px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none"
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-1 border-b border-border px-3">
        <h2 className="px-1.5 text-[15px] font-semibold text-foreground">Help</h2>
        <button
          type="button"
          aria-label="Close Help"
          onClick={onClose}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <X size={17} strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section aria-label="Shortcuts">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Shortcuts</h3>
          <dl className="mt-2 mb-5 space-y-1.5">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="flex items-baseline gap-3 text-[13.5px]">
                <dt className="w-24 flex-shrink-0 font-mono text-foreground">{shortcut.keys}</dt>
                <dd className="min-w-0 flex-1 text-muted-foreground">{shortcut.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <CommandGroup label="Commands" items={commands} />
        {skills.length > 0 && <CommandGroup label="Skills" items={skills} />}
      </div>
    </Dialog>
  );
}

function CommandGroup({
  label,
  items,
}: {
  label: 'Commands' | 'Skills';
  items: readonly { name: string; description: string }[];
}): React.ReactElement {
  return (
    <section aria-label={label} className="mb-5 last:mb-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.name} className="flex items-baseline gap-3 text-[13.5px]">
            <span className="w-24 flex-shrink-0 truncate font-mono text-foreground">/{item.name}</span>
            <span className="min-w-0 flex-1 text-muted-foreground">{item.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
