import type {
  IExecutionJournal,
  IResumeToolCallsOptions,
  TExecutionJournalRecord,
} from '../interfaces/execution-journal';
import type {
  IToolActionIdentity,
  IToolContinuation,
  IToolWaitState,
  IToolWaitResponse,
} from '../interfaces/tool-continuation';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { ExecutionSuspendedError } from '../utils/execution-suspended-error';
import { continuationJson, continuationObject } from '../utils/continuation-json';
import { randomId } from '../utils/random-id';
import { appendExecutionRecord } from './execution-journal';

/** Own the request state independently of objects handed to runtime code. */
export function toolContinuation(
  journal: IExecutionJournal,
  identity: IToolActionIdentity,
  saved: readonly IToolWaitState[] = [],
) {
  const action = structuredClone(identity);
  const waits = structuredClone(saved) as IToolWaitState[];
  let started = false;
  let failed: unknown;
  let suspended = false;
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const continuation: IToolContinuation = {
    get action() {
      return structuredClone(action);
    },
    get waits() {
      return structuredClone(waits);
    },
    request: (value) => {
      if (closed)
        return Promise.reject(
          new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'The tool continuation has already settled',
          ),
        );
      const prompt = structuredClone(value);
      const result = tail.then(async () => {
        if (failed) throw failed;
        if (started)
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_REQUIRED',
            'A started tool effect cannot become a pre-effect wait',
            [action.actionId],
          );
        if (!prompt || typeof prompt.kind !== 'string' || !prompt.kind)
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Continuation request kind is required',
          );
        continuationObject(prompt.data);
        const key = continuationJson([prompt.kind, prompt.data]);
        let wait = waits.find(
          (entry) => continuationJson([entry.request.kind, entry.request.data]) === key,
        );
        if (!wait) {
          const request = {
            ...action,
            requestId: randomId(),
            kind: prompt.kind,
            data: prompt.data,
          };
          await appendExecutionRecord(journal, {
            ...action,
            kind: 'tool-wait',
            recordId: `${request.requestId}:wait`,
            request: { requestId: request.requestId, kind: request.kind, data: request.data },
          });
          wait = { request };
          waits.push(wait);
        }
        if (wait.response) return structuredClone(wait.response.response);
        suspended = true;
        throw new ExecutionSuspendedError(
          waits.filter((entry) => !entry.response).map((entry) => entry.request),
        );
      });
      tail = result.catch((error: unknown) => {
        if (!(error instanceof ExecutionSuspendedError)) failed = error;
      });
      return result;
    },
  };
  return {
    continuation,
    settle: async () => {
      closed = true;
      await tail;
      if (failed) throw failed;
      if (suspended)
        throw new ExecutionSuspendedError(
          waits.filter((entry) => !entry.response).map((entry) => entry.request),
        );
    },
    admit: async (persist: () => Promise<void>) => {
      if (closed)
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'The tool continuation has already settled',
        );
      await tail;
      if (failed) throw failed;
      const pending = waits.filter((wait) => !wait.response);
      if (pending.length) throw new ExecutionSuspendedError(pending.map((wait) => wait.request));
      if (started)
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Tool effect admission was repeated',
        );
      started = true;
      try {
        await persist();
      } catch (error) {
        failed = error;
        throw error;
      }
    },
  };
}

/** Validate every response before appending any; a saved receipt makes exact redelivery harmless. */
export async function acceptToolResponses(
  records: readonly TExecutionJournalRecord[],
  options: IResumeToolCallsOptions,
): Promise<readonly TExecutionJournalRecord[]> {
  const additions: TExecutionJournalRecord[] = [];
  const all = [...records];
  for (const source of options.toolResponses ?? []) {
    const response: IToolWaitResponse = structuredClone(source);
    if (
      !response ||
      typeof response.requestId !== 'string' ||
      !response.requestId ||
      typeof response.responseId !== 'string' ||
      !response.responseId
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Tool response identities are required',
      );
    continuationObject(response.response);
    const previous = all.find(
      (record) =>
        record.kind === 'tool-response' &&
        (record.response.requestId === response.requestId ||
          record.response.responseId === response.responseId),
    );
    if (previous?.kind === 'tool-response') {
      if (continuationJson(previous.response) !== continuationJson(response))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_CONFLICT',
          'Tool response identity was already used',
        );
      continue;
    }
    const wait = all.find(
      (record) => record.kind === 'tool-wait' && record.request.requestId === response.requestId,
    );
    if (
      !wait ||
      wait.kind !== 'tool-wait' ||
      wait.parentCallId !== options.callId ||
      all.some(
        (record) =>
          'actionId' in record &&
          record.actionId === wait.actionId &&
          (record.kind === 'tool-effect-start' || record.kind === 'tool-result'),
      )
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'Tool request is absent, stale or already settled',
      );
    const record: TExecutionJournalRecord = {
      kind: 'tool-response',
      recordId: `${response.requestId}:response`,
      executionId: wait.executionId,
      actionId: wait.actionId,
      parentCallId: wait.parentCallId,
      toolCallId: wait.toolCallId,
      toolName: wait.toolName,
      response,
    };
    additions.push(record);
    all.push(record);
  }
  for (const record of additions) {
    options.signal?.throwIfAborted();
    await appendExecutionRecord(options.journal, record);
  }
  return all;
}
