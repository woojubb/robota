import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { IPermissionRequest } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

interface IProps {
  request: IPermissionRequest;
}

const OPTIONS = ['Allow', 'Deny'] as const;

function formatArgs(args: TToolArgs): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(no arguments)';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

export default function PermissionPrompt({ request }: IProps): React.ReactElement {
  const [selected, setSelected] = React.useState(0);
  const resolvedRef = React.useRef(false);
  const prevRequestRef = React.useRef(request);

  // Reset state when a new permission request comes in
  if (prevRequestRef.current !== request) {
    prevRequestRef.current = request;
    resolvedRef.current = false;
    setSelected(0);
  }

  const doResolve = React.useCallback(
    (allowed: boolean) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      request.resolve(allowed);
    },
    [request],
  );

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.upArrow || key.leftArrow) {
      setSelected((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.downArrow || key.rightArrow) {
      setSelected((prev) => (prev < OPTIONS.length - 1 ? prev + 1 : prev));
    } else if (key.return) {
      doResolve(selected === 0);
    } else if (input === 'y' || input === 'a' || input === '1') {
      doResolve(true);
    } else if (input === 'n' || input === 'd' || input === '2') {
      doResolve(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        [Permission Required]
      </Text>
      <Text>
        Tool:{' '}
        <Text color="cyan" bold>
          {request.toolName}
        </Text>
      </Text>
      <Text dimColor> {formatArgs(request.toolArgs)}</Text>
      <Box marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={opt} marginRight={2}>
            <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
              {i === selected ? '> ' : '  '}
              {opt}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor> left/right to select, Enter to confirm</Text>
    </Box>
  );
}
