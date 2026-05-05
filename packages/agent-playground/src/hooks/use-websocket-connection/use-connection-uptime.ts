'use client';

import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { UPTIME_UPDATE_INTERVAL_MS } from './constants';
import type { IConnectionInfo } from './types';

interface IUseConnectionUptimeParams {
  isConnected: boolean;
  connectionStartTimeRef: MutableRefObject<Date | null>;
  uptimeIntervalRef: MutableRefObject<NodeJS.Timeout | null>;
  setConnectionInfo: Dispatch<SetStateAction<IConnectionInfo>>;
}

export function useConnectionUptime({
  isConnected,
  connectionStartTimeRef,
  uptimeIntervalRef,
  setConnectionInfo,
}: IUseConnectionUptimeParams): void {
  useEffect(() => {
    if (isConnected && !uptimeIntervalRef.current) {
      uptimeIntervalRef.current = setInterval(() => {
        if (connectionStartTimeRef.current) {
          const uptime = Date.now() - connectionStartTimeRef.current.getTime();
          setConnectionInfo((prev) => ({ ...prev, uptime }));
        }
      }, UPTIME_UPDATE_INTERVAL_MS);
    } else if (!isConnected && uptimeIntervalRef.current) {
      clearInterval(uptimeIntervalRef.current);
      uptimeIntervalRef.current = null;
    }

    return () => {
      if (uptimeIntervalRef.current) {
        clearInterval(uptimeIntervalRef.current);
        uptimeIntervalRef.current = null;
      }
    };
  }, [connectionStartTimeRef, isConnected, setConnectionInfo, uptimeIntervalRef]);
}
