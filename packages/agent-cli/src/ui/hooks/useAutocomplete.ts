/**
 * Slash command autocomplete hook.
 * Extracted from InputArea.tsx for single-responsibility.
 */

import React, { useState, useMemo } from 'react';
import type { CommandRegistry } from '@robota-sdk/agent-sdk';
import type { ISlashCommand } from '../../commands/types.js';

/** Parse input to determine autocomplete state */
export function parseSlashInput(value: string): {
  isSlash: boolean;
  parentCommand: string;
  filter: string;
} {
  if (!value.startsWith('/')) return { isSlash: false, parentCommand: '', filter: '' };
  const afterSlash = value.slice(1);
  const spaceIndex = afterSlash.indexOf(' ');
  if (spaceIndex === -1) return { isSlash: true, parentCommand: '', filter: afterSlash };
  const parent = afterSlash.slice(0, spaceIndex);
  const rest = afterSlash.slice(spaceIndex + 1);
  return { isSlash: true, parentCommand: parent, filter: rest };
}

/** Hook: manage autocomplete state */
export function useAutocomplete(
  value: string,
  registry: CommandRegistry | undefined,
): {
  showPopup: boolean;
  filteredCommands: ISlashCommand[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  isSubcommandMode: boolean;
  setShowPopup: React.Dispatch<React.SetStateAction<boolean>>;
} {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed when input changes
  const prevValueRef = React.useRef(value);
  if (prevValueRef.current !== value) {
    prevValueRef.current = value;
    if (dismissed) setDismissed(false);
  }

  const parsed = parseSlashInput(value);
  const isSubcommandMode = parsed.isSlash && parsed.parentCommand.length > 0;

  const filteredCommands = useMemo(() => {
    if (!registry || !parsed.isSlash || dismissed) return [];
    if (isSubcommandMode) {
      const subs = registry.getSubcommands(parsed.parentCommand);
      if (subs.length === 0) return [];
      if (!parsed.filter) return subs;
      const lower = parsed.filter.toLowerCase();
      return subs.filter((c) => c.name.toLowerCase().startsWith(lower));
    }
    return registry.getCommands(parsed.filter);
  }, [registry, parsed.isSlash, parsed.parentCommand, parsed.filter, dismissed, isSubcommandMode]);

  const showPopup = parsed.isSlash && filteredCommands.length > 0 && !dismissed;

  // Clamp selectedIndex
  if (selectedIndex >= filteredCommands.length && filteredCommands.length > 0) {
    setSelectedIndex(filteredCommands.length - 1);
  }

  return {
    showPopup,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isSubcommandMode,
    setShowPopup: (val) => {
      if (typeof val === 'function') {
        setDismissed((prev) => {
          const nextVal = (val as (prev: boolean) => boolean)(!prev);
          return !nextVal;
        });
      } else {
        setDismissed(!val);
      }
    },
  };
}
