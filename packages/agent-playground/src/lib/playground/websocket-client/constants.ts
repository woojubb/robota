export const PLAYGROUND_WS_MESSAGE_TYPES = {
  PLAYGROUND_UPDATE: 'playground_update',
  AUTH: 'auth',
  PING: 'ping',
  PONG: 'pong',
} as const;

export const PLAYGROUND_WS_CLIENT_EVENTS = {
  AUTHENTICATED: 'authenticated',
  CONNECTION: 'connection',
  ERROR: 'error',
  PLAYGROUND_UPDATE: 'playground_update',
} as const;

export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30000;
export const PING_INTERVAL_MS = 30000;
export const NORMAL_CLOSE_CODE = 1000;
