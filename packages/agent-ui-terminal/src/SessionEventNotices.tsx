import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { usePalette } from './theme/index.js';

import type { ITuiSessionEventNotice } from './tui-session-events.js';

export interface ISessionEventNoticesProps {
  notices: readonly ITuiSessionEventNotice[];
}

export default function SessionEventNotices({
  notices,
}: ISessionEventNoticesProps): React.ReactElement | null {
  const palette = usePalette();
  if (notices.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      {notices.map((notice) => (
        <Text key={notice.id} color={palette.text.muted}>
          {notice.message}
        </Text>
      ))}
    </Box>
  );
}
