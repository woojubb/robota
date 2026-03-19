/**
 * Session — re-exported from @robota-sdk/agent-sessions.
 *
 * The canonical Session implementation now lives in agent-sessions.
 * This file provides backward-compatible re-exports for existing consumers.
 */

export { Session } from '@robota-sdk/agent-sessions';
export type { ISessionOptions, TPermissionHandler } from '@robota-sdk/agent-sessions';
