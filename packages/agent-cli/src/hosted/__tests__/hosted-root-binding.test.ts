import { describe, expect, it } from 'vitest';
import { decodeHostedRuntimeConfig } from '../hosted-runtime-config.js';
import { admitHostedRuntime, hostedAdmissionBytes } from '../hosted-runtime-admission.js';
import { hostedFixture } from './hosted-fixture.js';
import type { IHostedAdmissionProof } from '../hosted-runtime-types.js';

describe('hosted task ownership includes its root authority', () => {
  it('refuses legacy rootless admission configuration', async () => {
    const fixture = await hostedFixture();
    try {
      const identity = { ...fixture.config.identity } as Record<string, unknown>;
      delete identity.rootTask;
      expect(() =>
        decodeHostedRuntimeConfig({ ...fixture.config, version: 1, identity }),
      ).toThrow();
    } finally {
      await fixture.close();
    }
  });
  it('includes root ownership in the signature domain', async () => {
    const fixture = await hostedFixture();
    try {
      const proof = {
        version: fixture.config.version,
        identity: { ...fixture.config.identity, rootTask: 'root-a' },
        role: 'worker',
        resource: fixture.config.worker.resource,
        nonce: 'fixture',
        epoch: fixture.config.epoch,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000,
        snapshot: null,
        ready: true,
        limits: fixture.config.limits,
        usage: null,
      } as Omit<IHostedAdmissionProof, 'signature'>;
      const other = { ...proof, identity: { ...proof.identity, rootTask: 'root-b' } };
      expect(hostedAdmissionBytes(proof)).not.toEqual(hostedAdmissionBytes(other));
    } finally {
      await fixture.close();
    }
  });
  it('rejects a correctly signed backend proof issued for another root', async () => {
    const fixture = await hostedFixture();
    try {
      fixture.setProofTransform((proof) => ({
        ...proof,
        identity: { ...proof.identity, rootTask: 'another-root' },
      }));
      await expect(
        admitHostedRuntime({ environment: fixture.environment, resume: false }),
      ).rejects.toThrow(/does not match/);
    } finally {
      await fixture.close();
    }
  });
});
