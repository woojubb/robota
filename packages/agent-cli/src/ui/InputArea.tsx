import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CommandRegistry } from '../commands/command-registry.js';
import type { ISlashCommand } from '../commands/types.js';
import SlashAutocomplete from './SlashAutocomplete.js';

interface IProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
  registry?: CommandRegistry;
}

/** Parse input to determine autocomplete state */
function parseSlashInput(value: string): {
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
function useAutocomplete(
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

/**
 * IME composition tracking.
 * Terminal raw mode has no compositionstart/compositionend events.
 * Heuristic: if onChange fires, we're likely composing. After onChange
 * stops for IME_COMPOSE_TIMEOUT_MS, composition is considered done.
 * If Enter is pressed during composition, defer submit until composition ends.
 *
 * Reference: https://github.com/anthropics/claude-code/issues/3045
 */
const IME_COMPOSE_TIMEOUT_MS = 100;

export default function InputArea({ onSubmit, isDisabled, registry }: IProps): React.ReactElement {
  const [value, setValue] = useState('');
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // IME composition state
  const composingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = React.useRef(false);
  const pendingSubmitRef = React.useRef(false);

  const {
    showPopup,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isSubcommandMode,
    setShowPopup,
  } = useAutocomplete(value, registry);

  /** Execute the actual submit with current value */
  const doSubmit = useCallback((): void => {
    const current = valueRef.current.trim();
    if (current.length === 0) return;

    if (showPopup && filteredCommands[selectedIndex]) {
      selectCommand(filteredCommands[selectedIndex]);
      return;
    }

    setValue('');
    onSubmit(current);
  }, [showPopup, filteredCommands, selectedIndex, onSubmit]);

  /** onChange handler — tracks IME composition state */
  const handleChange = useCallback(
    (newValue: string): void => {
      setValue(newValue);

      // Mark as composing and reset timer
      isComposingRef.current = true;
      if (composingTimerRef.current) clearTimeout(composingTimerRef.current);
      composingTimerRef.current = setTimeout(() => {
        isComposingRef.current = false;
        // If Enter was pressed during composition, submit now
        if (pendingSubmitRef.current) {
          pendingSubmitRef.current = false;
          doSubmit();
        }
      }, IME_COMPOSE_TIMEOUT_MS);
    },
    [doSubmit],
  );

  /** Enter handler — defers if composing */
  const handleSubmit = useCallback((): void => {
    if (isComposingRef.current) {
      // Composing — defer submit until composition ends
      pendingSubmitRef.current = true;
      return;
    }
    doSubmit();
  }, [doSubmit]);

  const selectCommand = useCallback(
    (cmd: ISlashCommand): void => {
      const parsed = parseSlashInput(value);

      // If in subcommand mode, execute parent + subcommand
      if (parsed.parentCommand) {
        const fullCommand = `/${parsed.parentCommand} ${cmd.name}`;
        setValue('');
        onSubmit(fullCommand);
        return;
      }

      // If command has subcommands, enter subcommand mode
      if (cmd.subcommands && cmd.subcommands.length > 0) {
        setValue(`/${cmd.name} `);
        setSelectedIndex(0);
        return;
      }

      // Execute command directly
      setValue('');
      onSubmit(`/${cmd.name}`);
    },
    [value, onSubmit, setSelectedIndex],
  );

  useInput(
    (
      _input: string,
      key: { upArrow: boolean; downArrow: boolean; escape: boolean; tab: boolean },
    ) => {
      if (!showPopup) return;

      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
      } else if (key.escape) {
        setShowPopup(false);
      } else if (key.tab) {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) selectCommand(cmd);
      }
    },
    { isActive: showPopup && !isDisabled },
  );

  return (
    <Box flexDirection="column">
      {showPopup && (
        <SlashAutocomplete
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          visible={showPopup}
          isSubcommandMode={isSubcommandMode}
        />
      )}
      <Box borderStyle="single" borderColor={isDisabled ? 'gray' : 'green'} paddingLeft={1}>
        {isDisabled ? (
          <Text dimColor> Waiting for response...</Text>
        ) : (
          <Box>
            <Text color="green" bold>
              {'> '}
            </Text>
            <TextInput
              value={value}
              onChange={handleChange}
              onSubmit={() => handleSubmit()}
              placeholder="Type a message or /help"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
