import { HIGH_CONNECTION_ATTEMPTS_THRESHOLD, MAX_RECONNECT_DELAY_MS } from './constants';
import type { IConnectionHealth, IConnectionInfo, IConnectionStatistics } from './types';

export function createInitialConnectionInfo(): IConnectionInfo {
  return {
    state: 'disconnected',
    url: '',
    connected: false,
    lastConnected: null,
    lastDisconnected: null,
    connectionAttempts: 0,
    uptime: 0,
  };
}

export function createInitialConnectionStatistics(): IConnectionStatistics {
  return {
    totalConnections: 0,
    totalDisconnections: 0,
    totalReconnections: 0,
    averageConnectionTime: 0,
    longestConnection: 0,
    messagesSent: 0,
    messagesReceived: 0,
    lastError: null,
  };
}

export function calculateConnectionDuration(
  connectionStartTime: Date | null,
  disconnectTime: Date,
): number {
  return connectionStartTime ? disconnectTime.getTime() - connectionStartTime.getTime() : 0;
}

export function calculateAverageConnectionTime(
  statistics: IConnectionStatistics,
  connectionDuration: number,
): number {
  return statistics.totalConnections > 0
    ? (statistics.averageConnectionTime * (statistics.totalConnections - 1) + connectionDuration) /
        statistics.totalConnections
    : connectionDuration;
}

export function calculateReconnectDelay(
  reconnectInterval: number,
  connectionAttempts: number,
): number {
  return Math.min(reconnectInterval * Math.pow(2, connectionAttempts), MAX_RECONNECT_DELAY_MS);
}

export function buildConnectionHealth(
  isConnected: boolean,
  statistics: IConnectionStatistics,
  connectionInfo: IConnectionInfo,
): IConnectionHealth {
  const issues: string[] = [];
  let isHealthy = true;

  if (!isConnected) {
    issues.push('Not connected');
    isHealthy = false;
  }

  if (statistics.lastError) {
    issues.push(`Last error: ${statistics.lastError.message}`);
    isHealthy = false;
  }

  if (connectionInfo.connectionAttempts > HIGH_CONNECTION_ATTEMPTS_THRESHOLD) {
    issues.push('Multiple connection attempts');
    isHealthy = false;
  }

  return {
    isHealthy,
    latency: 0,
    lastPing: null,
    issues,
  };
}
