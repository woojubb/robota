/**
 * The device handshake (`agent-remote-pairing`, no workspace dependencies) produces an admission
 * that this carrier hands on as the session-mobility contract. The two are declared apart, so their
 * agreement is checked here, where both are in scope: the typecheck fails if either drifts.
 */
import { describe, expect, it } from 'vitest';

import type { IMeshAdmission, TMeshCapability } from '@robota-sdk/agent-interface-session-mobility';
import {
  DEVICE_CAPABILITIES,
  type IDeviceMeshAdmission,
  type TDeviceCapability,
} from '@robota-sdk/agent-remote-pairing';

type TEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const sameCapabilities: TEqual<TMeshCapability, TDeviceCapability> = true;
const sameLocality: TEqual<IMeshAdmission['locality'], IDeviceMeshAdmission['locality']> = true;
const sameTrust: TEqual<IMeshAdmission['trust'], IDeviceMeshAdmission['trust']> = true;

function asMeshAdmission(admission: IDeviceMeshAdmission): IMeshAdmission {
  return admission;
}

describe('mesh admission contract', () => {
  it('the handshake admission is the session-mobility admission', () => {
    expect([sameCapabilities, sameLocality, sameTrust]).toEqual([true, true, true]);
    const admission: IDeviceMeshAdmission = {
      trust: 'same-user-different-host',
      locality: 'another-host',
      deviceId: 'device',
      sessionId: 'session',
      capabilities: [...DEVICE_CAPABILITIES],
    };
    expect(asMeshAdmission(admission)).toBe(admission);
  });
});
