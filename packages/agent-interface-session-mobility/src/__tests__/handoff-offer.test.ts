import { describe, expect, it } from 'vitest';

import { assessHandoffReadiness, prepareHandoffOffer } from '../index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const record: IInteractiveSessionRecord = {
  id: 'session_1',
  cwd: '/home/alice/project',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T01:00:00.000Z',
  messages: [],
};

const offer = {
  handoffId: 'handoff_1',
  sessionId: 'session_1',
  sourceDeviceId: 'source',
  destinationDeviceId: 'destination',
  record,
  runtime: {},
  integrity: { digest: 'digest', byteLength: 123 },
  offeredAt: 1,
};

describe('handoff offer policy belongs to session mobility', () => {
  it('refuses unsettled work before a manifest can be offered', () => {
    const result = prepareHandoffOffer({
      ...offer,
      runtime: { modelCallInFlight: true, uncommittedChanges: true },
    });

    expect(result).toMatchObject({ built: false, refusal: 'in-flight-work' });
    expect(assessHandoffReadiness({ toolCallsInFlight: 1 })).toMatchObject({
      ready: false,
      refusal: 'in-flight-work',
    });
    expect(assessHandoffReadiness({ toolCallsInFlight: 0 })).toEqual({ ready: true });
  });

  it('classifies transferred, locally resolved, and source-local resources', () => {
    const result = prepareHandoffOffer({
      ...offer,
      runtime: { subprocesses: 2, uncommittedChanges: true },
    });

    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.manifest.inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'conversation', disposition: 'transferred' }),
        expect.objectContaining({ kind: 'provider-credentials', disposition: 'never-transferred' }),
        expect.objectContaining({ kind: 'working-directory', disposition: 'rehydrated' }),
        expect.objectContaining({ kind: 'uncommitted-changes', disposition: 'source-local' }),
        expect.objectContaining({ kind: 'subprocesses', disposition: 'source-local' }),
      ]),
    );
    expect(result.manifest.integrity).toBe(offer.integrity);
  });

  it('reports optional resources only when they exist', () => {
    const empty = prepareHandoffOffer(offer);
    expect(empty.built).toBe(true);
    if (!empty.built) return;
    expect(empty.manifest.inventory.map((item) => item.kind)).not.toContain('goal-and-plan');
    expect(empty.manifest.inventory.map((item) => item.kind)).not.toContain('background-work');
    expect(empty.manifest.inventory.map((item) => item.kind)).not.toContain('sandbox-snapshot');
    expect(empty.manifest.inventory.map((item) => item.kind)).not.toContain('subprocesses');

    const present = prepareHandoffOffer({
      ...offer,
      record: {
        ...record,
        goal: { id: 'g' } as IInteractiveSessionRecord['goal'],
        backgroundTasks: [{ id: 't' } as never],
        sandboxSnapshotId: 'snap_1',
      },
    });
    expect(present.built).toBe(true);
    if (!present.built) return;
    expect(present.manifest.inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'goal-and-plan', disposition: 'transferred' }),
        expect.objectContaining({ kind: 'background-work', disposition: 'transferred' }),
        expect.objectContaining({ kind: 'sandbox-snapshot', disposition: 'rehydrated' }),
      ]),
    );
  });
});
