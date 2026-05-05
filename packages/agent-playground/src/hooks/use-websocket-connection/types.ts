import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting';

export interface IConnectionInfo {
  state: TConnectionState;
  url: string;
  connected: boolean;
  lastConnected: Date | null;
  lastDisconnected: Date | null;
  connectionAttempts: number;
  uptime: number;
}

export interface IConnectionStatistics {
  totalConnections: number;
  totalDisconnections: number;
  totalReconnections: number;
  averageConnectionTime: number;
  longestConnection: number;
  messagesSent: number;
  messagesReceived: number;
  lastError: Error | null;
}

export interface IWebSocketAuth {
  userId: string;
  sessionId: string;
  authToken: string;
}

export interface IConnectionHealth {
  isHealthy: boolean;
  latency: number;
  lastPing: Date | null;
  issues: string[];
}

export interface IWebSocketConnectionHookReturn {
  connectionState: TConnectionState;
  connectionInfo: IConnectionInfo;
  isConnected: boolean;
  isConnecting: boolean;
  canConnect: boolean;
  statistics: IConnectionStatistics;
  connect: (url?: string, auth?: IWebSocketAuth) => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  sendMessage: (message: TUniversalValue) => boolean;
  setAutoReconnect: (enabled: boolean) => void;
  setReconnectInterval: (intervalMs: number) => void;
  setMaxReconnectAttempts: (attempts: number) => void;
  onMessage: (handler: (message: TUniversalValue) => void) => () => void;
  onConnectionChange: (handler: (state: TConnectionState) => void) => () => void;
  onError: (handler: (error: Error) => void) => () => void;
  ping: () => Promise<number>;
  getConnectionHealth: () => IConnectionHealth;
}
