import type { ILogger } from '@robota-sdk/agent-core';
import { useMemo } from 'react';

import { useCommonActions } from './use-common-actions';
import { useCreateAgentAction } from './use-create-agent-action';
import { usePromptActions } from './use-prompt-actions';
import { useRunExecutionAction } from './use-run-execution-action';
import type { IPlaygroundActionsValue, IPlaygroundRefs, TPlaygroundDispatch } from './types';

export function usePlaygroundContextActions(
  refs: IPlaygroundRefs,
  dispatch: TPlaygroundDispatch,
  logger: ILogger,
): IPlaygroundActionsValue {
  const createAgent = useCreateAgentAction(refs, dispatch);
  const runExecution = useRunExecutionAction(dispatch);
  const { executePrompt, executeStreamPrompt } = usePromptActions(
    refs,
    dispatch,
    runExecution,
    logger,
  );
  const commonActions = useCommonActions(refs, dispatch, logger);

  return useMemo(
    () => ({
      createAgent,
      executePrompt,
      executeStreamPrompt,
      ...commonActions,
    }),
    [commonActions, createAgent, executePrompt, executeStreamPrompt],
  );
}
