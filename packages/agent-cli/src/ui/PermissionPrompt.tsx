import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { IPermissionRequest } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

interface IProps {
  request: IPermissionRequest;
}

const OPTIONS = ['Allow', 'Allow always (this session)', 'Deny'] as const;

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
    (index: number) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      if (index === 0) request.resolve(true);
      else if (index === 1) request.resolve('allow-session');
      else request.resolve(false);
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
      doResolve(selected);
    } else if (input === 'y' || input === '1') {
      doResolve(0);
    } else if (input === 'a' || input === '2') {
      doResolve(1);
    } else if (input === 'n' || input === 'd' || input === '3') {
      doResolve(2);
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
