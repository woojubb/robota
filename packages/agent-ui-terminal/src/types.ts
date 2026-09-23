/** UI-layer permission types for the Ink TUI */

import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionResultValue } from '@robota-sdk/agent-interface-session';

/**
 * Permission result: true (allow once), false (deny), 'allow-session' (remember for session),
 * or 'allow-project' (persist through the host-selected project settings writer).
 */
export type TPermissionResult = TPermissionResultValue; // issue #2052: owned by agent-interface-session

export interface IPendingPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  canPersistProjectPermission?: boolean;
  resolve: (result: TPermissionResult) => void;
}
