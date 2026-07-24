/**
 * Session picker component for /resume command.
 * Shows a list of sessions for the current cwd.
 */

import { Box, Text } from 'ink';
import React from 'react';

import { SELECTION_INDICATOR, SELECTION_INDICATOR_NONE } from './key-hint-footer.js';
import ListPicker from './ListPicker.js';

import type { IResumableSessionSummary } from '@robota-sdk/agent-interface-transport';

const SESSION_ID_DISPLAY_LENGTH = 8;
const SESSION_PREVIEW_DISPLAY_LENGTH = 60;

interface IProps {
  sessions: readonly IResumableSessionSummary[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export default function SessionPicker({
  sessions,
  onSelect,
  onCancel,
}: IProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">
        Select a session to resume:
      </Text>
      <ListPicker<IResumableSessionSummary>
        items={[...sessions]}
        renderItem={(session: IResumableSessionSummary, isSelected: boolean) => {
          const preview = session.preview
            ? session.preview.slice(0, SESSION_PREVIEW_DISPLAY_LENGTH) +
              (session.preview.length > SESSION_PREVIEW_DISPLAY_LENGTH ? '...' : '')
            : '';
          return (
            <Text>
              {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
              <Text bold>{session.name ?? session.id.slice(0, SESSION_ID_DISPLAY_LENGTH)}</Text>
              {'  '}
              <Text dimColor>
                {new Date(session.updatedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              {'  '}
              <Text dimColor>msgs: {session.messageCount}</Text>
              {preview ? (
                <>
                  {'\n    '}
                  <Text color="gray">{preview}</Text>
                </>
              ) : null}
            </Text>
          );
        }}
        onSelect={(session: IResumableSessionSummary) => onSelect(session.id)}
        onCancel={onCancel}
      />
    </Box>
  );
}
