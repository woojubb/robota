import type { TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

export type TCommandEffect =
  | { type: 'model-change-requested'; modelId: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'statusline-settings-patch'; patch: Record<string, TUniversalValue> };
