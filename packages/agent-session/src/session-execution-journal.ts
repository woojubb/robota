import { realpathSync } from 'node:fs';
import { ExecutionRecoveryError } from '@robota-sdk/agent-core';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
} from '@robota-sdk/agent-core';

interface ISessionJournalOwner {
  sessionId: string;
  cwd: string;
  peerTurn: boolean;
}

/** Stamp runtime authority separately from display-only message attribution. */
export function sessionExecutionJournal(
  journal: IExecutionJournal,
  owner: ISessionJournalOwner,
): IExecutionJournal {
  const cwd = realpathSync(owner.cwd);
  return {
    append: async (record) => {
      if (
        (record.kind === 'model-request' || record.kind === 'model-cache-hit') &&
        record.checkpoint
      ) {
        const saved = structuredClone(record);
        saved.checkpoint!.owner = {
          kind: 'robota-session',
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
): IRecoverableExecutionJournal {
  let writer: IExecutionJournal | undefined;
  const scope = realpathSync(cwd);
  return {
    read: async (executionId) => {
      const records = structuredClone(await journal.read(executionId));
      let peerTurn: boolean | undefined;
      for (const record of records) {
        if (record.kind !== 'model-request' && record.kind !== 'model-cache-hit') continue;
        const owner = record.checkpoint?.owner;
        const state = owner?.state;
        if (
          !owner ||
          owner.kind !== 'robota-session' ||
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
      writer = sessionExecutionJournal(journal, { sessionId, cwd, peerTurn });
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
