import React from 'react';
import { Box, Text } from 'ink';
import type { ICommand } from '@robota-sdk/agent-sdk';

interface IProps {
  /** Filtered list of commands to display */
  commands: ICommand[];
  /** Currently highlighted item index */
  selectedIndex: number;
  /** Whether to show the popup */
  visible: boolean;
  /** Whether showing subcommands (no slash prefix) */
  isSubcommandMode?: boolean;
}

const MAX_VISIBLE = 8;
const MAX_ROW_LENGTH = 72;

function truncateDesc(name: string, description: string, showSlash: boolean): string {
  // indicator(2) + optional slash(1) + name + separator(2)
  const prefixLen = showSlash ? 2 + 1 + name.length + 2 : 2 + name.length + 2;
  const allowed = Math.max(10, MAX_ROW_LENGTH - prefixLen);
  return description.length > allowed ? `${description.slice(0, allowed)}\u2026` : description;
}

/** Render a single command row */
function CommandRow(props: {
  cmd: ICommand;
  isSelected: boolean;
  showSlash: boolean;
}): React.ReactElement {
  const { cmd, isSelected, showSlash } = props;
  const indicator = isSelected ? '\u25b8 ' : '  ';
  const nameColor = isSelected ? 'cyan' : undefined;
  const dimmed = !isSelected;
  const description = truncateDesc(cmd.name, cmd.description ?? '', showSlash);

  return (
    <Box>
      <Text color={nameColor} dimColor={dimmed}>
        {indicator}
        {showSlash ? `/${cmd.name}  ${description}` : description}
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
