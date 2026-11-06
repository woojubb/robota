import { expect, it, vi } from 'vitest';

import { openRegisteredOwnerLink } from '../owner-link-client.js';
import { openSecureAttach } from '../secure-attach-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { IOwnerRuntimeLinkClient, IRuntimeCustodyState } from '@robota-sdk/agent-transport-link';

vi.mock('../owner-link-client.js', () => ({ openRegisteredOwnerLink: vi.fn() }));

it('binds owner decisions to the driver returned by this exact link and signals closure', async () => {
  let finishClose!: () => void;
  let custodyChanged!: (state: IRuntimeCustodyState) => void;
  const closed = new Promise<void>((resolve) => { finishClose = resolve; });
  const question = vi.fn(async () => ({ kind: 'open' as const }));
  const cancelQuestion = vi.fn(async () => undefined);
  const openAccepted = vi.fn(async () => undefined);
  const link: IOwnerRuntimeLinkClient = {
    standing: 'owner',
    binding: { runtimeId: 'runtime', generation: 'generation' },
    instancePublicKey: new Uint8Array(),
    custody: { unlocked: true, certified: true },
    onCustody: (listener) => { custodyChanged = listener; return () => undefined; },
    installTrustRoot: async () => undefined,
    unlock: async () => 'verified',
    lock: async () => undefined,
    question,
    cancelQuestion,
    openAccepted,
    control: async () => ({ status: 'attached', driverId: 'attach:exact' }),
    session: { send: vi.fn(), onMessage: () => () => undefined },
    closed,
    close: finishClose,
  };
  vi.mocked(openRegisteredOwnerLink).mockResolvedValue(link);
  const attach = await openSecureAttach({ root: '/tmp', id: 'runtime', generation: 'generation', mode: 'drive', handover: {} as IOwnerHandover });
  const owner = attach.ownerSessions;
  expect(owner).toBeDefined();
  if (owner === undefined) throw new Error('Missing owner-only decisions');
  expect(await owner.directory.question('session_target')).toEqual({ kind: 'open' });
  await owner.directory.cancelQuestion();
  await owner.directory.openAccepted('session_target', 'ab'.repeat(32), 'question-1');
  expect(question).toHaveBeenCalledExactlyOnceWith('session_target');
  expect(cancelQuestion).toHaveBeenCalledOnce();
  expect(link.session.send).not.toHaveBeenCalled();
  const invalidated = vi.fn();
  owner.onInvalidate(invalidated);
  custodyChanged({ unlocked: true, certified: true });
  expect(invalidated).toHaveBeenCalledOnce();
  expect(openAccepted).toHaveBeenCalledExactlyOnceWith('attach:exact', 'session_target', 'ab'.repeat(32), 'question-1');
  invalidated.mockClear();
  cancelQuestion.mockRejectedValueOnce(new Error('cancel refused'));
  await expect(owner.directory.cancelQuestion()).rejects.toThrow('cancel refused');
  await closed;
  await vi.waitFor(() => expect(invalidated).toHaveBeenCalledOnce());
});
