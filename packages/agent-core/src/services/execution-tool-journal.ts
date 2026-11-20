import { randomId } from '../utils/random-id';
import { ExecutionJournalError } from '../utils/execution-journal-error';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import {
  isSnapshotableUniversalValue,
  isUniversalValueEqual,
} from '../utils/universal-value-equal';
import { appendExecutionRecord } from './execution-journal';
import { toolContinuation } from './execution-tool-waits';
import type { IExecutionJournal } from '../interfaces/execution-journal';
import type { IManagedToolReceipt } from '../interfaces/managed-provider';
import type { IAssistantMessage } from '../interfaces/messages';
import type { IToolExecutionResult } from '../interfaces/tool';
import type { IRecoveredToolBatch } from './execution-recovery-state';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';
import { isValidToolCallIdentity } from './tool-call-identity';
import {
  ARGUMENT_DECODE_ERROR_CODE,
  TOOL_CALL_SKIPPED_ERROR_CODE,
  UNKNOWN_TOOL_ERROR_CODE,
} from './tool-execution-constants';

export interface IToolBatchJournalContext {
  journal: IExecutionJournal;
  parentCallId: string;
  recovery?: IRecoveredToolBatch;
  /** Keep immutable result snapshots when the caller needs durable action receipts. */
  captureReceipts?: boolean;
  /** The caller must durably record this complete frame before dispatching the batch. */
  assistantFrame?: IAssistantMessage;
}

export interface IToolBatchJournalSettlement {
  /** Return a complete receipt set only after every result has been durably acknowledged. */
  receipts(): readonly IManagedToolReceipt[] | undefined;
}

function validSettlement(
  action: { toolCallId: string; toolName: string },
  result: IToolExecutionResult,
  effectStarted: boolean,
  dispatched: boolean,
): boolean {
  const code = result?.metadata?.errorCode;
  return (
    result !== null &&
    typeof result === 'object' &&
    result.executionId === action.toolCallId &&
    result.toolName === action.toolName &&
    typeof result.success === 'boolean' &&
    (code !== TOOL_CALL_SKIPPED_ERROR_CODE ||
      (!result.success &&
        !dispatched &&
        !effectStarted &&
        result.metadata?.dispatchStatus === 'not-dispatched' &&
        result.result === null)) &&
    (code !== ARGUMENT_DECODE_ERROR_CODE || (!dispatched && !effectStarted)) &&
    (code !== UNKNOWN_TOOL_ERROR_CODE || !effectStarted) &&
    (result.success
      ? effectStarted && result.result !== undefined
      : typeof result.error === 'string' && result.error.length > 0)
  );
}

/** Prepare the durable boundaries for a complete batch before the executor can dispatch it. */
export async function attachToolBatchJournal(
  batch: IToolExecutionBatchContext,
  executionId: string,
  context: IToolBatchJournalContext,
  getLoadedDeferredTools: () => string[] | undefined,
): Promise<IToolBatchJournalSettlement | undefined> {
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
  if (context.captureReceipts) {
    if (recovery && (recovery.executionId !== executionId || recovery.callId !== parentCallId)) {
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'Saved actions belong to another execution or assistant frame',
      );
    }
    const callIds = actions.map((action) => action.toolCallId);
    const actionIds = actions.map((action) => action.actionId);
    if (
      actions.length === 0 ||
      !isValidToolCallIdentity(executionId) ||
      !isValidToolCallIdentity(parentCallId) ||
      callIds.some((id) => !isValidToolCallIdentity(id)) ||
      actionIds.some((id) => !isValidToolCallIdentity(id)) ||
      actions.some((action) => !isValidToolCallIdentity(action.toolName)) ||
      new Set(callIds).size !== actions.length ||
      new Set(actionIds).size !== actions.length ||
      recovered.some((entry, index) => {
        const result = entry?.result;
        return (
          result !== undefined &&
          !validSettlement(
            actions[index],
            result,
            entry?.effectStarted === true,
            entry?.dispatched === true,
          )
        );
      })
    ) {
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Tool batch identities cannot be correlated with their settlements',
      );
    }
    const uncertain = recovered.flatMap((entry) =>
      entry?.effectStarted && !entry.result ? [entry.actionId] : [],
    );
    if (uncertain.length > 0) {
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_REQUIRED',
        'Tool effects have no durable result; reconcile them before resuming',
        uncertain,
      );
    }
  }
  const settlements: Array<IToolExecutionResult | undefined> | undefined = context.captureReceipts
    ? recovered.map((action) => (action?.result ? structuredClone(action.result) : undefined))
    : undefined;
  const admitted = context.captureReceipts
    ? recovered.map((action) => action?.effectStarted === true)
    : undefined;
  const dispatched = context.captureReceipts
    ? recovered.map((action) => action?.dispatched === true)
    : undefined;
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
    beforeDispatch: async (index) => {
      if (!recovered[index]?.dispatched)
        await appendExecutionRecord(journal, {
          kind: 'tool-dispatch',
          recordId: `${actions[index].actionId}:dispatch`,
          ...actions[index],
        });
      if (dispatched) dispatched[index] = true;
    },
    onResult: async (index, result) => {
      // The receipt must use the same snapshot the journal accepted, even if a caller later
      // mutates the executor's result while the append is pending.
      const record = {
        kind: 'tool-result',
        recordId: `${actions[index].actionId}:result`,
        ...actions[index],
        result,
        loadedDeferredTools: getLoadedDeferredTools(),
      } as const;
      if (
        settlements &&
        !validSettlement(
          actions[index],
          result,
          admitted?.[index] === true,
          dispatched?.[index] === true,
        )
      ) {
        throw new ExecutionJournalError(record, new Error('Invalid tool settlement'));
      }
      let snapshot: typeof record;
      try {
        snapshot = structuredClone(record);
        // Recovery currently compares records through JSON; never acknowledge a result it cannot read.
        JSON.stringify(snapshot);
      } catch (error) {
        throw new ExecutionJournalError(record, error);
      }
      await appendExecutionRecord(journal, snapshot);
      if (settlements) settlements[index] = snapshot.result;
      return structuredClone(snapshot.result);
    },
    beforeEffect: async (index, parameters) => {
      if (!isSnapshotableUniversalValue(parameters))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Tool parameters cannot be represented for effect admission',
        );
      let snapshot: typeof parameters;
      try {
        snapshot = structuredClone(parameters);
      } catch {
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Tool parameters cannot be recorded for effect admission',
        );
      }
      if (!isUniversalValueEqual(parameters, snapshot))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Tool parameters cannot be represented for effect admission',
        );
      await continuations[index].admit(() =>
        appendExecutionRecord(journal, {
          kind: 'tool-effect-start',
          recordId: `${actions[index].actionId}:effect-start`,
          ...actions[index],
          parameters: snapshot,
        }),
      );
      if (!isUniversalValueEqual(parameters, snapshot))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_REQUIRED',
          'Tool parameters changed while effect admission was being recorded',
          [actions[index].actionId],
        );
      if (admitted) admitted[index] = true;
    },
  };
  batch.recoveredResults = new Map(
    recovered.flatMap((action, index) => (action?.result ? [[index, action.result] as const] : [])),
  );
  if (!settlements) return undefined;
  return {
    receipts: () => {
      const receipts: IManagedToolReceipt[] = [];
      for (const [index, action] of actions.entries()) {
        const result = settlements[index];
        if (
          !result ||
          result.executionId !== action.toolCallId ||
          result.toolName !== action.toolName
        )
          return undefined;
        receipts.push({
          toolCallId: action.toolCallId,
          actionId: action.actionId,
          result: structuredClone(result),
        });
      }
      return receipts;
    },
  };
}
