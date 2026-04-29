import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface IProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | undefined;
  allowEmpty?: boolean;
  masked?: boolean;
}

export default function TextPrompt({
  title,
  placeholder,
  onSubmit,
  onCancel,
  validate,
  allowEmpty = false,
  masked = false,
}: IProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const resolvedRef = useRef(false);
  const valueRef = useRef('');
  const handleSubmit = useCallback(() => {
    if (resolvedRef.current) return;
    const trimmed = valueRef.current.trim();
    if (!trimmed && !allowEmpty) {
      const emptyError = validate?.(trimmed);
      if (emptyError) {
        setError(emptyError);
      }
      return;
    }
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setError(err);
        return;
      }
    }
    resolvedRef.current = true;
    onSubmit(trimmed);
  }, [allowEmpty, validate, onSubmit]);

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.escape) {
      resolvedRef.current = true;
      onCancel();
      return;
    }
    if (key.return) {
      handleSubmit();
      return;
    }
    if (key.backspace || key.delete) {
      valueRef.current = valueRef.current.slice(0, -1);
      setValue(valueRef.current);
      setError(undefined);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      valueRef.current = valueRef.current + input;
      setValue(valueRef.current);
      setError(undefined);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">&gt; </Text>
        {value ? (
          <Text>{masked ? '*'.repeat(value.length) : value}</Text>
        ) : placeholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : null}
        <Text color="cyan">█</Text>
      </Box>
      {error && <Text color="red">{error}</Text>}
      <Text dimColor> Enter Submit Esc Cancel</Text>
    </Box>
  );
}
