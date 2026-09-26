import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';
import { describe, expect, it } from 'vitest';

import { createHandoffConsent } from '../handoff/handoff-consent.js';

import type {
  ICapabilityApprovalRequest,
  IHandoffManifest,
  IOperatorApprover,
  IPeerAdmission,
} from '@robota-sdk/agent-interface-session-mobility';

/**
 * The consent at the DESTINATION is the connection's `handoff` authority: the operator here is asked
 * for every transfer, on the approver no connected surface can answer. There is one way to say yes.
 */

const ADMISSION: IPeerAdmission = {
  admitted: true,
  trust: 'same-user-different-host',
  origin: { sessionId: 'desktop' },
};

const MANIFEST: IHandoffManifest = {
  handoffId: 'handoff-1',
  sessionId: 'session-1',
  sourceDeviceId: 'desktop',
  destinationDeviceId: 'laptop',
  inventory: [],
  integrity: { digest: 'x'.repeat(43), byteLength: 1234 },
  offeredAt: 1,
};

function consentWith(
  approver: IOperatorApprover | undefined,
  capabilities: ConstructorParameters<typeof ConnectionAuthority>[0]['capabilities'] = ['handoff'],
) {
  const authority = new ConnectionAuthority(
    { deviceId: 'desktop', locality: 'another-host', capabilities },
    approver,
  );
  return createHandoffConsent({ authority, deviceLabel: 'this laptop' });
}

function operator(answer: boolean) {
  const asked: ICapabilityApprovalRequest[] = [];
  const approver: IOperatorApprover = {
    approve: async (request) => {
      asked.push(request);
      return answer;
    },
  };
  return { asked, approver };
}

describe('the destination operator decides every hand-off', () => {
  it('accepts on the operator yes, asking once for this transfer', async () => {
    const { asked, approver } = operator(true);
    const consent = consentWith(approver);
    expect(await consent(ADMISSION, MANIFEST)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ capability: 'handoff', scope: 'request' });
  });

  it('asks again for the next transfer: a yes covers one request', async () => {
    const { asked, approver } = operator(true);
    const consent = consentWith(approver);
    await consent(ADMISSION, MANIFEST);
    await consent(ADMISSION, { ...MANIFEST, handoffId: 'handoff-2' });
    expect(asked).toHaveLength(2);
  });

  it('refuses when the operator says no', async () => {
    const { approver } = operator(false);
    expect(await consentWith(approver)(ADMISSION, MANIFEST)).toBe(false);
  });

  it('refuses when there is nobody to ask', async () => {
    expect(await consentWith(undefined)(ADMISSION, MANIFEST)).toBe(false);
  });

  it('refuses without asking when the connection was not granted hand-off', async () => {
    const { asked, approver } = operator(true);
    expect(await consentWith(approver, ['message'])(ADMISSION, MANIFEST)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('never asks about an admission that was refused', async () => {
    const { asked, approver } = operator(true);
    const refused: IPeerAdmission = { admitted: false, trust: 'unproven', reason: 'bad grant' };
    expect(await consentWith(approver)(refused, MANIFEST)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('says what taking the session means here: saved, not started, and this machine’s credential', async () => {
    const { asked, approver } = operator(true);
    await consentWith(approver)(ADMISSION, MANIFEST);
    const summary = asked[0]?.summary ?? '';
    expect(summary).toContain('session-1');
    expect(summary).toContain('this laptop');
    expect(summary).toContain('not started');
    expect(summary).toContain("this machine's provider credential");
  });
});
