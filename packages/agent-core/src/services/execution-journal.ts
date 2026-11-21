import type {
  IExecutionJournal,
  IExecutionRoundCheckpoint,
  IModelJournalContext,
  TExecutionJournalRecord,
  TJournalModelOptions,
} from '../interfaces/execution-journal';
import type { TUniversalMessage } from '../interfaces/messages';
import type { TManagedToolBatch } from '../interfaces/managed-provider';
import type { IToolSchema } from '../interfaces/tool-schema';
import type { IChatOptions } from '../interfaces/provider';
import { ExecutionJournalError } from '../utils/execution-journal-error';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { recoverToolBatch } from './execution-recovery-state';

export async function appendExecutionRecord(
  journal: IExecutionJournal,
  record: TExecutionJournalRecord,
): Promise<void> {
  try {
    await journal.append(structuredClone(record));
  } catch (error) {
    throw new ExecutionJournalError(record, error);
  }
}

/** Commit a complete managed assistant frame before any of its tool actions can be journaled. */
export async function commitManagedToolFrame(
  journal: IExecutionJournal,
  identity: {
    executionId: string;
    callId: string;
    providerId: string;
    modelId: string;
    checkpoint: IExecutionRoundCheckpoint;
    tools: readonly IToolSchema[];
  },
  frame: TManagedToolBatch,
): Promise<TManagedToolBatch> {
  let record: Extract<TExecutionJournalRecord, { kind: 'managed-frame' }>;
  try {
    record = structuredClone({
      kind: 'managed-frame',
      recordId: `${identity.callId}:frame`,
      executionId: identity.executionId,
      callId: identity.callId,
      providerId: identity.providerId,
      modelId: identity.modelId,
      checkpoint: identity.checkpoint,
      tools: identity.tools,
      response: frame,
    });
  } catch {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Managed assistant frame cannot be recorded',
    );
  }
  recoverToolBatch([record], identity.executionId, identity.callId);
  await appendExecutionRecord(journal, record);
  return structuredClone(record.response);
}

/** Deliberately projects data fields so local callbacks and transport secrets cannot enter the journal. */
function modelOptions(options: IChatOptions): TJournalModelOptions {
  return {
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { tools: options.tools }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options.nativeWebTools !== undefined && { nativeWebTools: options.nativeWebTools }),
    ...(options.responseFormat !== undefined && { responseFormat: options.responseFormat }),
  };
}

export async function callJournaledProvider(
  chat: (messages: TUniversalMessage[], options: IChatOptions) => Promise<TUniversalMessage>,
  messages: TUniversalMessage[],
  options: IChatOptions,
  context?: IModelJournalContext,
): Promise<TUniversalMessage> {
  if (!context) return chat(messages, options);
  const { journal, executionId, callId } = context;
  await appendExecutionRecord(journal, {
    kind: 'model-request',
    recordId: `${callId}:request`,
    executionId,
    callId,
    ...context.route(),
    messages,
    options: modelOptions(options),
    ...(context.checkpoint && { checkpoint: context.checkpoint }),
  });
  options.signal?.throwIfAborted();
  let response: TUniversalMessage;
  try {
    response = await chat(messages, options);
  } catch (error) {
    await appendExecutionRecord(journal, {
      kind: 'model-failure',
      recordId: `${callId}:failure`,
      executionId,
      callId,
      ...context.route(),
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
  // This records a settled response even if cancellation arrived while the provider was running.
  await appendExecutionRecord(journal, {
    kind: 'model-response',
    recordId: `${callId}:response`,
    executionId,
    callId,
    ...context.route(),
    response,
  });
  return response;
}
