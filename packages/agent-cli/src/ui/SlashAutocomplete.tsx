import React from 'react';
import { Box, Text } from 'ink';
import type { ISlashCommand } from '../commands/types.js';

interface IProps {
  /** Filtered list of commands to display */
  commands: ISlashCommand[];
  /** Currently highlighted item index */
  selectedIndex: number;
  /** Whether to show the popup */
  visible: boolean;
  /** Whether showing subcommands (no slash prefix) */
  isSubcommandMode?: boolean;
}

const MAX_VISIBLE = 8;

/** Render a single command row */
function CommandRow(props: {
  cmd: ISlashCommand;
  isSelected: boolean;
  showSlash: boolean;
}): React.ReactElement {
  const { cmd, isSelected, showSlash } = props;
  const prefix = showSlash ? '/' : '';
  const indicator = isSelected ? '\u25b8 ' : '  ';
  const nameColor = isSelected ? 'cyan' : undefined;
  const dimmed = !isSelected;

  return (
    <Box>
      <Text color={nameColor} dimColor={dimmed}>
        {indicator}
        {prefix}
        {cmd.name}
      </Text>
      <Text dimColor={dimmed}>{'  '}</Text>
      <Text color={nameColor} dimColor={dimmed}>
        {cmd.description}
      </Text>
    </Box>
  );
}

/** Autocomplete popup showing matching slash commands */
export default function SlashAutocomplete({
  commands,
  selectedIndex,
  visible,
  isSubcommandMode,
}: IProps): React.ReactElement | null {
  if (!visible || commands.length === 0) return null;

  const scrollOffset = computeScrollOffset(selectedIndex, commands.length);
  const visibleCommands = commands.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {visibleCommands.map((cmd, i) => (
        <CommandRow
          key={cmd.name}
          cmd={cmd}
          isSelected={scrollOffset + i === selectedIndex}
          showSlash={!isSubcommandMode}
        />
      ))}
    </Box>
  );
}

/** Compute scroll offset to keep selectedIndex visible */
function computeScrollOffset(selectedIndex: number, total: number): number {
  if (total <= MAX_VISIBLE) return 0;
  if (selectedIndex < MAX_VISIBLE) return 0;
  const maxOffset = total - MAX_VISIBLE;
  return Math.min(selectedIndex - MAX_VISIBLE + 1, maxOffset);
}
