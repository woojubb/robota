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
// border(1\u00d72) + paddingX(1\u00d72) consumed by outer box; inner content stays within this width
const ROW_WIDTH = 72;

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
  const text = showSlash
    ? `${indicator}/${cmd.name}  ${cmd.description ?? ''}`
    : `${indicator}${cmd.name}  ${cmd.description ?? ''}`;

  return (
    <Box width={ROW_WIDTH}>
      <Text color={nameColor} dimColor={dimmed} wrap="truncate-end">
        {text}
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
