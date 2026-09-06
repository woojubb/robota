import { useCallback, useRef, useState } from 'react';

import type {
  IWsSessionState,
  TCurrentSessionUsageReport,
  TPersonalUsageReport,
  TStoredSessionUsageReport,
} from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

type TPersonalUsageState = Pick<
  IWsSessionState,
  | 'personalUsageStatus'
  | 'personalUsageReport'
  | 'personalUsageError'
  | 'requestPersonalUsage'
  | 'storedSessionUsageStatus'
  | 'storedSessionUsageReport'
  | 'storedSessionUsageSessionId'
  | 'storedSessionUsageError'
  | 'requestStoredSessionUsage'
  | 'currentSessionUsageStatus'
  | 'currentSessionUsageReport'
  | 'requestCurrentSessionUsage'
>;

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}_${requestCounter}_${Date.now()}`;
}

/** Own the correlated aggregate/stored/current usage protocol state independently from chat state. */
export function usePersonalUsageState(send: (msg: TClientMessage) => void): TPersonalUsageState & {
  handleUsageMessage: (msg: TServerMessage) => boolean;
} {
  const [personalUsageStatus, setPersonalUsageStatus] =
    useState<IWsSessionState['personalUsageStatus']>('idle');
  const [personalUsageReport, setPersonalUsageReport] = useState<TPersonalUsageReport | null>(null);
  const [personalUsageError, setPersonalUsageError] = useState<string | null>(null);
  const [storedSessionUsageStatus, setStoredSessionUsageStatus] =
    useState<IWsSessionState['storedSessionUsageStatus']>('idle');
  const [storedSessionUsageReport, setStoredSessionUsageReport] =
    useState<TStoredSessionUsageReport | null>(null);
  const [storedSessionUsageSessionId, setStoredSessionUsageSessionId] = useState<string | null>(null);
  const [storedSessionUsageError, setStoredSessionUsageError] = useState<string | null>(null);
  const [currentSessionUsageStatus, setCurrentSessionUsageStatus] =
    useState<IWsSessionState['currentSessionUsageStatus']>('idle');
  const [currentSessionUsageReport, setCurrentSessionUsageReport] =
    useState<TCurrentSessionUsageReport | null>(null);
  const personalRequestRef = useRef<string | null>(null);
  const storedRequestRef = useRef<string | null>(null);

  const handleUsageMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type === 'personal_usage_report' || msg.type === 'personal_usage_report_error') {
      if (personalRequestRef.current !== msg.requestId) return true;
      setPersonalUsageReport(msg.type === 'personal_usage_report' ? msg.report : null);
      setPersonalUsageError(msg.type === 'personal_usage_report_error' ? msg.message : null);
      setPersonalUsageStatus(msg.type === 'personal_usage_report' ? 'ready' : 'error');
      return true;
    }
    if (msg.type === 'usage_report') {
      setCurrentSessionUsageReport(msg.report);
      setCurrentSessionUsageStatus('ready');
      return true;
    }
    if (msg.type === 'stored_session_usage_report' || msg.type === 'stored_session_usage_report_error') {
      if (storedRequestRef.current !== msg.requestId) return true;
      setStoredSessionUsageReport(msg.type === 'stored_session_usage_report' ? msg.report : null);
      setStoredSessionUsageSessionId(msg.sessionId);
      setStoredSessionUsageError(
        msg.type === 'stored_session_usage_report_error' ? msg.message : null,
      );
      setStoredSessionUsageStatus(msg.type === 'stored_session_usage_report' ? 'ready' : 'error');
      return true;
    }
    if (msg.type === 'protocol_error') {
      setCurrentSessionUsageStatus((current) => (current === 'loading' ? 'error' : current));
    }
    return false;
  }, []);

  const requestPersonalUsage = useCallback(
    (period: '7d' | '30d'): void => {
      const requestId = nextRequestId('personal_usage');
      personalRequestRef.current = requestId;
      setPersonalUsageStatus('loading');
      setPersonalUsageError(null);
      send({
        type: 'get-personal-usage-report',
        requestId,
        period,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
    },
    [send],
  );

  const requestStoredSessionUsage = useCallback(
    (sessionId: string): void => {
      const requestId = nextRequestId('stored_session_usage');
      storedRequestRef.current = requestId;
      setStoredSessionUsageStatus('loading');
      setStoredSessionUsageReport(null);
      setStoredSessionUsageSessionId(sessionId);
      setStoredSessionUsageError(null);
      send({ type: 'get-stored-session-usage-report', requestId, sessionId });
    },
    [send],
  );

  const requestCurrentSessionUsage = useCallback((): void => {
    setCurrentSessionUsageStatus('loading');
    send({ type: 'get-usage-report' });
  }, [send]);

  return {
    personalUsageStatus,
    personalUsageReport,
    personalUsageError,
    requestPersonalUsage,
    storedSessionUsageStatus,
    storedSessionUsageReport,
    storedSessionUsageSessionId,
    storedSessionUsageError,
    requestStoredSessionUsage,
    currentSessionUsageStatus,
    currentSessionUsageReport,
    requestCurrentSessionUsage,
    handleUsageMessage,
  };
}
