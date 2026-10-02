import { messageToHistoryEntry } from '@robota-sdk/agent-core';
import {
  decodeVersionedInteractiveSessionRecord,
  isSafeSessionId,
  SESSION_RECORD_ENVELOPE_VERSION,
} from '@robota-sdk/agent-session';
import { hostedAdmissionError } from './hosted-runtime-config.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

/** Conversation data survives; current composition rebuilds prompts, policy and execution state. */
export function projectHostedSessionCheckpoint(
  value: unknown,
  workspaceRoot: string,
): IInteractiveSessionRecord {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch {
    throw hostedAdmissionError('conversation checkpoint is not serializable');
  }
  if (encoded === undefined || Buffer.byteLength(encoded) > 8 * 1024 * 1024)
    throw hostedAdmissionError('conversation checkpoint exceeds its byte budget');
  const outcome = decodeVersionedInteractiveSessionRecord(value);
  if (outcome.status !== 'valid' || !isSafeSessionId(outcome.record.id))
    throw hostedAdmissionError('conversation checkpoint record or selector is invalid');
  const source = outcome.record;
  if (source.messages.length > 10_000)
    throw hostedAdmissionError('conversation checkpoint exceeds its message budget');
  const messages = source.messages.filter((message) => message.role !== 'system').map((message) => {
    // Metadata can select special runtime interpretation; historical text remains untrusted data.
    const { metadata: _metadata, ...conversation } = message;
    return conversation;
  });
  if (messages.length === 0)
    throw hostedAdmissionError('conversation checkpoint has no conversation to restore');
  const projected: IInteractiveSessionRecord = {
    id: source.id,
    ...(source.name === undefined ? {} : { name: source.name }),
    cwd: workspaceRoot,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    messages,
    history: messages.map(messageToHistoryEntry),
  };
  if (hostedSessionCheckpointBytes(projected).byteLength > 8 * 1024 * 1024)
    throw hostedAdmissionError('conversation checkpoint display history exceeds its byte budget');
  return projected;
}

export function hostedSessionCheckpointBytes(record: IInteractiveSessionRecord): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record }));
}
