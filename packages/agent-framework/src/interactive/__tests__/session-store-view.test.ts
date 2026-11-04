/**
 * The one way a store is decorated (#3679 step 3e): a view that changes how some calls behave and
 * forwards every other member of the port as the store has it, so a member a decorator does not name
 * is never dropped — and a session over the view is gated exactly as over the store.
 */

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import { decorateSessionStore } from '../session-store-view.js';
import { isSessionAuthorshipRefusedError } from '../session-authorship-gate.js';
import {
  authorshipOf,
  cleanUpSealedSessionFixtures,
  construct,
  digestOfFile,
  directory,
  forgeRecord,
  readFresh,
  record,
  sealedStore,
  sessionOptions,
  started,
} from './helpers/sealed-session-fixtures.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const FORGED_TEXT = 'CANARY-3e-view-forged-2c77';

afterEach(cleanUpSealedSessionFixtures);

describe('a store view built with the shared decorator', () => {
  it('still gates a resume: an unverified record is refused, an accepted one is raised', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const saved: string[] = [];
    const view = decorateSessionStore(store, {
      save: (value: IInteractiveSessionRecord, options) => {
        saved.push(value.id);
        store.save(value, options);
      },
    });

    const refused = construct(sessionOptions(cwd, view, { resumeSessionId: 'sess_planted' }));
    expect(refused.session).toBeUndefined();
    expect(isSessionAuthorshipRefusedError(refused.error)).toBe(true);

    await started(
      sessionOptions(cwd, view, {
        resumeSessionId: 'sess_planted',
        acceptedDigest: digestOfFile(dir, 'sess_planted'),
      }),
    );
    expect(authorshipOf(readFresh(dir, sealer, 'sess_planted'))).toBe('verified');
    expect(saved).toContain('sess_planted');
  });

  it('forwards every member the store has, and none it does not', () => {
    const sealing = decorateSessionStore(sealedStore(directory(), createTestArtifactSealer()), {});
    const plain = decorateSessionStore(new NodeSessionStore(directory(), { sealing: 'plain' }), {});

    for (const member of ['save', 'load', 'list', 'scan', 'claim', 'delete'] as const) {
      expect(typeof sealing[member]).toBe('function');
      expect(typeof plain[member]).toBe('function');
    }
    expect(sealing.authorship).toBeDefined();
    expect('authorship' in plain).toBe(false);
  });
});
