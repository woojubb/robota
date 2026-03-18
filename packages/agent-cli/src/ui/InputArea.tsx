import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface IProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
}

export default function InputArea({ onSubmit, isDisabled }: IProps): React.ReactElement {
  const [value, setValue] = React.useState('');

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setValue('');
    onSubmit(trimmed);
  };

  return (
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
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="Type a message or /help"
          />
        </Box>
      )}
    </Box>
  );
}
