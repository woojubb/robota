import { randomId } from '../utils/random-id';
import { appendExecutionRecord } from './execution-journal';
import { toolContinuation } from './execution-tool-waits';
import type { IExecutionJournal } from '../interfaces/execution-journal';
import type { IRecoveredToolBatch } from './execution-recovery-state';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

export interface IToolBatchJournalContext {
  journal: IExecutionJournal;
  parentCallId: string;
  recovery?: IRecoveredToolBatch;
}

/** Prepare the durable boundaries for a complete batch before the executor can dispatch it. */
export async function attachToolBatchJournal(
  batch: IToolExecutionBatchContext,
  executionId: string,
  context: IToolBatchJournalContext,
  getLoadedDeferredTools: () => string[] | undefined,
): Promise<void> {
  const { journal, parentCallId, recovery } = context;
  const requests = batch.requests;
  const recovered = requests.map((request) => recovery?.actions.get(request.executionId ?? ''));
  const actions = requests.map((request) => ({
    actionId: recovery?.actions.get(request.executionId ?? '')?.actionId ?? randomId(),
    parentCallId,
    executionId,
    toolCallId: request.executionId ?? '',
    toolName: request.toolName,
  }));
  const continuations = actions.map((action, index) =>
    toolContinuation(journal, action, recovered[index]?.waits),
  );
  // Every decoded intent must be durable before ANY member of the batch is dispatched.
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    if (
      request.argumentDecodeError !== undefined ||
      recovered[index]?.intent ||
      recovered[index]?.result
    )
      continue;
    await appendExecutionRecord(journal, {
      kind: 'tool-intent',
      recordId: `${actions[index].actionId}:intent`,
      ...actions[index],
      parameters: request.parameters,
    });
  }
  batch.journal = {
    continuation: (index) => continuations[index].continuation,
    settle: (index) => continuations[index].settle(),
    beforeDispatch: (index) =>
      recovered[index]?.dispatched
        ? Promise.resolve()
        : appendExecutionRecord(journal, {
            kind: 'tool-dispatch',
            recordId: `${actions[index].actionId}:dispatch`,
            ...actions[index],
          }),
    onResult: (index, result) =>
      appendExecutionRecord(journal, {
        kind: 'tool-result',
        recordId: `${actions[index].actionId}:result`,
        ...actions[index],
        result,
        loadedDeferredTools: getLoadedDeferredTools(),
      }),
    beforeEffect: (index, parameters) =>
      continuations[index].admit(() =>
        appendExecutionRecord(journal, {
          kind: 'tool-effect-start',
          recordId: `${actions[index].actionId}:effect-start`,
          ...actions[index],
          parameters,
        }),
      ),
  };
  batch.recoveredResults = new Map(
    recovered.flatMap((action, index) => (action?.result ? [[index, action.result] as const] : [])),
  );
}
