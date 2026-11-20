import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isJsonEqual } from '../utils/json-equal';
import { isValidToolCallIdentity } from './tool-call-identity';
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

/** Compare the data-bearing metadata used to bind a receipt to its committed history. */
export function sameReceiptMetadata(
  leftMetadata: IAssistantMessage['metadata'],
  rightMetadata: IAssistantMessage['metadata'],
): boolean {
  if (leftMetadata === undefined || rightMetadata === undefined)
    return leftMetadata === rightMetadata;
  if (
    leftMetadata === null ||
    rightMetadata === null ||
    typeof leftMetadata !== 'object' ||
    typeof rightMetadata !== 'object' ||
    Object.getPrototypeOf(leftMetadata) !== Object.prototype ||
    Object.getPrototypeOf(rightMetadata) !== Object.prototype
  )
    return false;
  const keys = Object.keys(leftMetadata);
  if (keys.length !== Object.keys(rightMetadata).length) return false;
  return keys.every((key) => {
    if (!Object.hasOwn(rightMetadata, key)) return false;
    const a = leftMetadata[key];
    const b = rightMetadata[key];
    if (a instanceof Date || b instanceof Date)
      return (
        a instanceof Date &&
        b instanceof Date &&
        Number.isFinite(a.getTime()) &&
        a.getTime() === b.getTime()
      );
    return isJsonEqual(a, b);
  });
}

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
