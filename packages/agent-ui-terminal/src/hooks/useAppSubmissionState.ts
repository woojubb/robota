import { useCallback, useEffect, useRef, useState } from 'react';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';

interface IOptions {
  readonly selectedEntry: IExecutionWorkspaceEntry | undefined;
  readonly submit: (input: string) => Promise<void>;
  readonly sendAgentJob: (taskId: string, input: string) => Promise<void>;
  readonly isThinking: boolean;
}

export interface IAppSubmissionState {
  readonly submit: (input: string) => Promise<void>;
  readonly gitRefreshToken: number;
}

export function useAppSubmissionState(options: IOptions): IAppSubmissionState {
  const [gitRefreshToken, setGitRefreshToken] = useState(0);
  const routedSubmit = useCallback(
    async (input: string): Promise<void> => {
      const entry = options.selectedEntry;
      if (entry && entry.kind !== 'main_thread' && entry.controls.includes('send')) {
        await options.sendAgentJob(entry.sourceId, input);
        return;
      }
      await options.submit(input);
    },
    [options.selectedEntry, options.sendAgentJob, options.submit],
  );
  const submit = useCallback(
    async (input: string): Promise<void> => {
      setGitRefreshToken((token) => token + 1);
      await routedSubmit(input);
    },
    [routedSubmit],
  );
  const wasThinkingRef = useRef(false);
  useEffect(() => {
    if (wasThinkingRef.current && !options.isThinking) {
      setGitRefreshToken((token) => token + 1);
    }
    wasThinkingRef.current = options.isThinking;
  }, [options.isThinking]);
  return { submit, gitRefreshToken };
}
