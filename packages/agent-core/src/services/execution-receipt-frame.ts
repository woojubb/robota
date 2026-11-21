import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isJsonEqual } from '../utils/json-equal';
import { isValidToolCallIdentity } from './tool-call-identity';
import { sameReceiptMetadata } from '../utils/receipt-metadata';
import type { IAssistantMessage, IToolCall } from '../interfaces/messages';
import type { IToolBatchJournalContext } from './execution-tool-journal';

/** A frame's timestamp and date-valued metadata need value comparison alongside JSON data. */
function sameFrame(left: IAssistantMessage, right: IAssistantMessage): boolean {
  const { timestamp: leftTime, metadata: leftMetadata, ...leftData } = left;
  const { timestamp: rightTime, metadata: rightMetadata, ...rightData } = right;
  if (
    !(leftTime instanceof Date) ||
    !(rightTime instanceof Date) ||
    !Number.isFinite(leftTime.getTime()) ||
    leftTime.getTime() !== rightTime.getTime() ||
    !isJsonEqual(leftData, rightData) ||
    Object.hasOwn(left, 'metadata') !== Object.hasOwn(right, 'metadata')
  )
    return false;
  return sameReceiptMetadata(leftMetadata, rightMetadata);
}

export { sameReceiptMetadata } from '../utils/receipt-metadata';

/** Snapshot and bind a receipt-enabled batch before any asynchronous journal work begins. */
export function snapshotReceiptFrame(
  input: IToolCall[],
  context: IToolBatchJournalContext,
): { calls: IToolCall[]; context: IToolBatchJournalContext } {
  try {
    const calls = structuredClone(input);
    const frame = structuredClone(context.assistantFrame);
    const recovery = context.recovery ? structuredClone(context.recovery) : undefined;
    if (
      frame?.role === 'assistant' &&
      frame.state === 'complete' &&
      isValidToolCallIdentity(frame.id) &&
      frame.timestamp instanceof Date &&
      Number.isFinite(frame.timestamp.getTime()) &&
      (frame.content === null || typeof frame.content === 'string') &&
      Array.isArray(frame.toolCalls) &&
      frame.toolCalls.length > 0 &&
      isJsonEqual(calls, frame.toolCalls) &&
      (!recovery || sameFrame(frame, recovery.response))
    ) {
      return {
        calls,
        context: { ...context, assistantFrame: frame, ...(recovery && { recovery }) },
      };
    }
  } catch {
    // An unrepresentable frame cannot establish the identity of saved actions.
  }
  throw new ExecutionRecoveryError(
    'EXECUTION_RECOVERY_CONFLICT',
    'Tool calls or assistant frame do not match the saved execution',
  );
}
