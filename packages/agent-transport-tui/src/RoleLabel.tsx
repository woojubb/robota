import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';
import { Text } from 'ink';
import React from 'react';

import { PALETTE } from './tui-palette.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * Who a transcript line is attributed to, and in what colour. Extracted from MessageList when
 * PEER-007 gave the `user` case a second thing to decide: the label stopped being a constant per
 * role, so it is its own responsibility rather than four inline returns.
 */

/**
 * PEER-007 (issue #1915): the operator's own turns stay `You:`; a turn driven by anyone else is
 * labelled with WHO drove it, so a co-driven transcript can be read after the fact. `owner` is the
 * operator, so it reads as `You:` too; anything else prints as itself (`peer:<session-id>`, `agent`).
 */
function driverLabel(driverId: string): string {
  return driverId === OWNER_DRIVER_ID ? 'You' : driverId;
}

export function RoleLabel({
  role,
  driverId,
}: {
  role: TUniversalMessage['role'];
  driverId?: string;
}): React.ReactElement {
  switch (role) {
    case 'user':
      return (
        <Text color={PALETTE.text.success} bold>
          {driverId !== undefined ? driverLabel(driverId) : 'You'}:{' '}
        </Text>
      );
    case 'assistant':
      return (
        <Text color={PALETTE.text.accent} bold>
          Robota:{' '}
        </Text>
      );
    case 'system':
      return (
        <Text color={PALETTE.text.warning} bold>
          System:{' '}
        </Text>
      );
    case 'tool':
      return (
        <Text color={PALETTE.text.emphasis} bold>
          Tool:{' '}
        </Text>
      );
  }
}
