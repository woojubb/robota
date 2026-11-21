import { assertRawJournalPolicyRecords, ExecutionRecoveryError } from '@robota-sdk/agent-core';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
} from '@robota-sdk/agent-core';

interface ISessionJournalOwner {
  sessionId: string;
  cwd: string;
  peerTurn: boolean;
  /** The host's canonical spelling of a directory; the scope a recovery is checked against. */
  canonicalizePath: (path: string) => string;
}

function isRecoverableJournal(journal: IExecutionJournal): journal is IRecoverableExecutionJournal {
  return 'read' in journal && typeof journal.read === 'function';
}

/** Stamp runtime authority separately from display-only message attribution. */
export function sessionExecutionJournal(
  journal: IExecutionJournal,
  owner: ISessionJournalOwner,
): IExecutionJournal & Partial<Pick<IRecoverableExecutionJournal, 'read'>> {
  const cwd = owner.canonicalizePath(owner.cwd);
  const recoverable = isRecoverableJournal(journal) ? journal : undefined;
  return {
    ...(recoverable ? { read: (executionId: string) => recoverable.read(executionId) } : {}),
    append: async (record) => {
      if (
        (record.kind === 'model-request' ||
          record.kind === 'model-cache-hit' ||
          record.kind === 'managed-frame') &&
        record.checkpoint
      ) {
        const saved = structuredClone(record);
        saved.checkpoint!.owner = {
          kind: 'agent-session',
          version: 1,
          state: {
            sessionId: owner.sessionId,
            cwd,
            peerTurn: owner.peerTurn,
            executionId: record.executionId,
          },
        };
        await journal.append(saved);
      } else await journal.append(record);
    },
  };
}

/** Reject a different session/scope and restore peer authority before any resumed effect. */
export function sessionRecoveryJournal(
  journal: IRecoverableExecutionJournal,
  sessionId: string,
  cwd: string,
  beginTurn: (peerTurn: boolean) => void,
  canonicalizePath: (path: string) => string,
): IRecoverableExecutionJournal {
  let writer: IExecutionJournal | undefined;
  const scope = canonicalizePath(cwd);
  return {
    read: async (executionId) => {
      const source = await journal.read(executionId);
      assertRawJournalPolicyRecords(source);
      const records = structuredClone(source);
      let peerTurn: boolean | undefined;
      for (const record of records) {
        if (
          record.kind !== 'model-request' &&
          record.kind !== 'model-cache-hit' &&
          record.kind !== 'managed-frame'
        )
          continue;
        const owner = record.checkpoint?.owner;
        const state = owner?.state;
        if (
          !owner ||
          owner.kind !== 'agent-session' ||
          owner.version !== 1 ||
          !state ||
          state.sessionId !== sessionId ||
          state.cwd !== scope ||
          state.executionId !== executionId ||
          typeof state.peerTurn !== 'boolean' ||
          (peerTurn !== undefined && peerTurn !== state.peerTurn) ||
          (state.peerTurn && record.checkpoint?.continuation?.options.withholdHostedTools !== true)
        ) {
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Session continuation owner or scope is incompatible',
          );
        }
        peerTurn = state.peerTurn;
      }
      if (peerTurn === undefined)
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'No Session owner checkpoint exists',
        );
      writer = sessionExecutionJournal(journal, { sessionId, cwd, peerTurn, canonicalizePath });
      beginTurn(peerTurn);
      return records;
    },
    append: async (record: TExecutionJournalRecord) => {
      if (!writer)
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Session owner has not been restored',
        );
      await writer.append(record);
    },
  };
}
