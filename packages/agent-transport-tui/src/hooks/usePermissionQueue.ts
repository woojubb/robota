import { useState, useRef, useCallback } from 'react';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionResultValue } from '@robota-sdk/agent-sdk';
import type { IPermissionRequest } from '../types.js';

export function usePermissionQueue(): {
  permissionHandler: (toolName: string, toolArgs: TToolArgs) => Promise<TPermissionResultValue>;
  permissionRequest: IPermissionRequest | null;
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const permissionQueueRef = useRef<
    Array<{
      toolName: string;
      toolArgs: TToolArgs;
      resolve: (result: TPermissionResultValue) => void;
    }>
  >([]);
  const processingRef = useRef(false);

  const processNextPermission = useCallback(() => {
    if (processingRef.current) return;
    const next = permissionQueueRef.current[0];
    if (!next) {
      setPermissionRequest(null);
      return;
    }
    processingRef.current = true;
    setPermissionRequest({
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result: TPermissionResultValue) => {
        permissionQueueRef.current.shift();
        processingRef.current = false;
        setPermissionRequest(null);
        next.resolve(result);
        setTimeout(() => processNextPermission(), 0);
      },
    });
  }, []);

  const permissionHandler = useCallback(
    (toolName: string, toolArgs: TToolArgs): Promise<TPermissionResultValue> =>
      new Promise<TPermissionResultValue>((resolve) => {
        permissionQueueRef.current.push({ toolName, toolArgs, resolve });
        processNextPermission();
      }),
    [processNextPermission],
  );

  return { permissionHandler, permissionRequest };
}
