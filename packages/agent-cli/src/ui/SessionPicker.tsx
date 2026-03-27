/**
 * Session picker component for /resume command.
 * Shows a list of sessions for the current cwd.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionStore, ISessionRecord } from '@robota-sdk/agent-sessions';
import ListPicker from './ListPicker.js';

const SESSION_ID_DISPLAY_LENGTH = 8;

interface IProps {
  sessionStore?: SessionStore;
  cwd: string;
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export default function SessionPicker({
  sessionStore,
  cwd,
  onSelect,
  onCancel,
}: IProps): React.ReactElement {
  const sessions = (sessionStore?.list() ?? []).filter((s) => s.cwd === cwd);

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">
        Select a session to resume (ESC to cancel):
      </Text>
      <ListPicker<ISessionRecord>
        items={sessions}
        renderItem={(session: ISessionRecord, isSelected: boolean) => {
          const lastMsg = session.messages
            .slice()
            .reverse()
            .find((m) => {
              const msg = m as { role?: string; content?: string };
              return msg.role === 'assistant' && msg.content;
            }) as { content?: string } | undefined;
          const rawPreview = lastMsg?.content?.replace(/[\n\r]+/g, ' ').trim() ?? '';
          const preview = rawPreview
            ? rawPreview.slice(0, 60) + (rawPreview.length > 60 ? '...' : '')
            : '';
          return (
            <Text>
              {isSelected ? '> ' : '  '}
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
              <Text dimColor>msgs: {session.messages.length}</Text>
              {preview ? (
                <>
                  {'\n    '}
                  <Text color="gray">{preview}</Text>
                </>
              ) : null}
            </Text>
          );
        }}
        onSelect={(session: ISessionRecord) => onSelect(session.id)}
        onCancel={onCancel}
      />
    </Box>
  );
}
