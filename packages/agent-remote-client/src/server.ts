/**
 * Server entry point for @robota-sdk/agent-remote-client
 */

export { RemoteServer } from './server/remote-server';

// Atomic Types (server consumers may need the shared message shapes)
export type {
  IPlaygroundWebSocketMessage,
  TPlaygroundWebSocketMessageKind,
} from './types/playground-websocket';
