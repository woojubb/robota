/**
 * Session picker component for /resume command.
 * Shows a list of sessions for the current cwd.
 */

import { Box } from 'ink';
import React from 'react';

import { SELECTION_INDICATOR, SELECTION_INDICATOR_NONE } from './key-hint-footer.js';
import ListPicker from './ListPicker.js';
import { Text } from './SafeText.js';
import { shortSessionId } from './short-session-id.js';
import { usePalette } from './theme/index.js';

import type { ISessionListingEntry } from '@robota-sdk/agent-interface-session';

const SESSION_PREVIEW_DISPLAY_LENGTH = 60;

/**
 * `● live · 2 clients` on a host that keeps sessions live: the session runs there now, and that many
 * clients are on it. Null for a stored session, and for a host that says neither.
 */
export function sessionLiveBadge(session: ISessionListingEntry): string | null {
  const parts: string[] = [];
  if (session.live === true) parts.push('● live');
  if (session.clients !== undefined && session.clients > 0) {
    parts.push(`${session.clients} ${session.clients === 1 ? 'client' : 'clients'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface IProps {
  sessions: readonly ISessionListingEntry[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export default function SessionPicker({
  sessions,
  onSelect,
  onCancel,
}: IProps): React.ReactElement {
  const palette = usePalette();
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color={palette.text.accent}>
        Select a session to resume:
      </Text>
      <ListPicker<ISessionListingEntry>
        items={[...sessions]}
        renderItem={(session: ISessionListingEntry, isSelected: boolean) => {
          const badge = sessionLiveBadge(session);
          const preview = session.preview
            ? session.preview.slice(0, SESSION_PREVIEW_DISPLAY_LENGTH) +
              (session.preview.length > SESSION_PREVIEW_DISPLAY_LENGTH ? '...' : '')
            : '';
          return (
            <Text>
              {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
              <Text bold>{session.name ?? shortSessionId(session.id)}</Text>
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
              {badge !== null ? (
                <>
                  {'  '}
                  <Text color={palette.text.success}>{badge}</Text>
                </>
              ) : null}
              {preview ? (
                <>
                  {'\n    '}
                  <Text dimColor>{preview}</Text>
                </>
              ) : null}
            </Text>
          );
        }}
        onSelect={(session: ISessionListingEntry) => onSelect(session.id)}
        onCancel={onCancel}
      />
    </Box>
  );
}
