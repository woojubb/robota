import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

export interface IMenuSelectItem {
  label: string;
  value: string;
  hint?: string;
}

interface IProps {
  title: string;
  items: IMenuSelectItem[];
  onSelect: (value: string) => void;
  onBack: () => void;
  loading?: boolean;
  error?: string;
}

export default function MenuSelect({
  title,
  items,
  onSelect,
  onBack,
  loading,
  error,
}: IProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(0);
  const resolvedRef = useRef(false);

  const doSelect = useCallback(
    (index: number) => {
      if (resolvedRef.current || items.length === 0) return;
      resolvedRef.current = true;
      onSelect(items[index].value);
    },
    [items, onSelect],
  );

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.escape) {
      resolvedRef.current = true;
      onBack();
      return;
    }
    if (loading || error || items.length === 0) return;
    if (key.upArrow) {
      const next = selectedRef.current > 0 ? selectedRef.current - 1 : selectedRef.current;
      selectedRef.current = next;
      setSelected(next);
    } else if (key.downArrow) {
      const next =
        selectedRef.current < items.length - 1 ? selectedRef.current + 1 : selectedRef.current;
      selectedRef.current = next;
      setSelected(next);
    } else if (key.return) {
      doSelect(selectedRef.current);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>Loading...</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">{error}</Text>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      )}
      {!loading && !error && (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, i) => (
            <Box key={item.value}>
              <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
                {i === selected ? '> ' : '  '}
                {item.label}
              </Text>
              {item.hint && <Text dimColor> {item.hint}</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Text dimColor>{loading || error ? '' : ' ↑↓ Navigate  Enter Select  Esc Back'}</Text>
    </Box>
  );
}
