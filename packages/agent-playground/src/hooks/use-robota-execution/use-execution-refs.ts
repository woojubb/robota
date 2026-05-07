import { useRef } from 'react';
import type { IExecutionRefs } from './types';

export function useExecutionRefs(): IExecutionRefs {
  return {
    lastPromptRef: useRef<string>(''),
    executionTimeoutRef: useRef<NodeJS.Timeout | null>(null),
    abortControllerRef: useRef<AbortController | null>(null),
  };
}
