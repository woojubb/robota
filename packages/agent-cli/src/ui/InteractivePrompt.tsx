import React from 'react';
import { Box, Text } from 'ink';
import type { TInteractivePrompt, IChoicePromptOption } from '../utils/interactive-prompt.js';
import ListPicker from './ListPicker.js';
import TextPrompt from './TextPrompt.js';

interface IInteractivePromptProps {
  prompt: TInteractivePrompt;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export default function InteractivePrompt({
  prompt,
  onSubmit,
  onCancel,
}: IInteractivePromptProps): React.ReactElement {
  if (prompt.kind === 'text') {
    return (
      <TextPrompt
        key={`text:${prompt.title}`}
        title={prompt.title}
        description={prompt.description}
        placeholder={prompt.placeholder}
        allowEmpty={prompt.allowEmpty}
        masked={prompt.masked}
        validate={prompt.validate}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{prompt.title}</Text>
      {prompt.description !== undefined && prompt.description.length > 0 && (
        <Text dimColor>{prompt.description}</Text>
      )}
      <ListPicker<IChoicePromptOption>
        items={[...prompt.options]}
        maxVisible={prompt.maxVisible}
        renderItem={(option, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {option.label}
          </Text>
        )}
        onSelect={(option) => onSubmit(option.value)}
        onCancel={onCancel}
      />
    </Box>
  );
}
