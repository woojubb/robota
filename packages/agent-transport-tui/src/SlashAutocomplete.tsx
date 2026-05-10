import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
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
// border(1×2) + paddingX(1×2) consumed by outer box
const OUTER_CHROME = 4;
const MIN_ROW_WIDTH = 40;

function useRowWidth(): number {
  const { stdout } = useStdout();
  const measure = () => Math.max(MIN_ROW_WIDTH, (stdout.columns ?? 80) - OUTER_CHROME);
  const [width, setWidth] = useState(measure);

  useEffect(() => {
    const onResize = () => setWidth(measure());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return width;
}

/** Render a single command row */
function CommandRow(props: {
  cmd: ICommand;
  isSelected: boolean;
  showSlash: boolean;
  rowWidth: number;
}): React.ReactElement {
  const { cmd, isSelected, showSlash, rowWidth } = props;
  const indicator = isSelected ? '▸ ' : '  ';
  const nameColor = isSelected ? 'cyan' : undefined;
  const dimmed = !isSelected;
  const text = showSlash
    ? `${indicator}/${cmd.name}  ${cmd.description ?? ''}`
    : `${indicator}${cmd.name}  ${cmd.description ?? ''}`;

  return (
    <Box width={rowWidth}>
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
  const rowWidth = useRowWidth();

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
          rowWidth={rowWidth}
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
