import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

import type {
  IEditCheckpointStore,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
} from '../index.js';

/**
 * The edit checkpoint store and the session stores keep their records in files and seal and migrate
 * them through `@robota-sdk/agent-session/node`, so they are on `./node`; the main entry has what a
 * host with no files needs: the store contracts, the errors, the listing helpers over any store.
 * This pins which side each export is on, so a move back is a visible test failure.
 */
describe('checkpoint and session store entry surfaces', () => {
  const nodeOnly = [
    'EditCheckpointStore',
    'createDirectoryEditCheckpointState',
    'migrateWorkspaceEditCheckpoints',
    'createProjectSessionStore',
    'createNodeHostSessionStore',
    'createNodeToolResultSpillStore',
    'createUserSessionStore',
    'createUserPromptHistoryFile',
    'sweepStaleToolResultSpillDirectories',
    'WorkspaceProjectSessionStore',
    'ProjectSessionDeletionStoppedError',
    'removeSubagentLogs',
    'WorkspaceSessionLogSink',
    'WorkspaceSessionLogSource',
    'migrateWorkspaceProjectSessionLogs',
    'migrateWorkspaceProjectSessionRecords',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it.each([
    'EditCheckpointsUnavailableError',
    'EditCheckpointsLockedError',
    'EditCheckpointUnreadableError',
    'EditCheckpointNumberingExhaustedError',
    'wrapEditCheckpointTools',
    'decorateSessionStore',
    'scanSessionStore',
    'listResumableSessions',
    'listResumableSessionSummaries',
    'listUnreadableSessions',
    'listUnreadableSessionsForWorkspace',
    'resolveSessionIdByIdOrName',
    'resolveLatestSessionId',
    'resolveReusableEmptySessionId',
    'lockedSessionsNotice',
    'isSafeSessionId',
  ])('%s stays on the main entry', (name) => {
    expect(Object.keys(MainEntry)).toContain(name);
    expect(Object.keys(NodeEntry)).not.toContain(name);
  });

  it('types a host’s own stores from the main entry', () => {
    // A compile-level pin: a host with no files brings its own session and checkpoint stores, so the
    // contracts they implement are on the main entry, and the entry's built types carry them too.
    const contracts = (
      store: IInteractiveSessionStore,
      record: IInteractiveSessionRecord,
      summary: IResumableSessionSummary,
      outcome: TSessionLoadOutcome,
      checkpoints: IEditCheckpointStore,
    ) => [store, record, summary, outcome, checkpoints];
    expect(contracts).toBeTypeOf('function');
  });
});
