/**
 * Server entry point for @robota-sdk/remote
 */

export { RemoteServer } from './server/remote-server'; 

// Atomic Types (server consumers may need the shared message shapes)
export type { IPlaygroundWebSocketMessage, TPlaygroundWebSocketMessageType } from './types/playground-websocket';