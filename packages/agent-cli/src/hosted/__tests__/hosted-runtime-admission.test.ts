import { chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { admitHostedRuntime } from '../hosted-runtime-admission.js';
import { decodeHostedRuntimeConfig, readHostedRuntimeConfig } from '../hosted-runtime-config.js';
import { hostedFixture } from './hosted-fixture.js';
import type { IHostedAdmissionProof } from '../hosted-runtime-types.js';

const fixtures: Awaited<ReturnType<typeof hostedFixture>>[] = [];
async function fixture() {
  const value = await hostedFixture();
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) await value.close();
});

describe('hosted admission against actual signed HTTP responses', () => {
  it('validates both identities with Korean/emoji identifiers and a fresh challenge', async () => {
    const value = await fixture();
    const first = await admitHostedRuntime({ environment: value.environment, resume: false });
    const second = await admitHostedRuntime({ environment: value.environment, resume: false });
    expect(first?.worker.identity).toEqual(value.config.identity);
    expect(first?.broker.role).toBe('broker');
    expect(second?.worker.nonce).not.toBe(first?.worker.nonce);
    expect(value.requests()).toBe(4);
  });

  it.each(['worker', 'broker'] as const)(
    'denies a missing %s backend instead of accepting the other proof',
    async (role) => {
      const value = await fixture();
      value.setUnavailable(role);
      await expect(
        admitHostedRuntime({ environment: value.environment, resume: false }),
      ).rejects.toThrow(`${role} backend is unavailable`);
    },
  );

  it.each([
    [
      'task',
      (p: IHostedAdmissionProof) => ({ ...p, identity: { ...p.identity, task: 'other-task' } }),
      /identity/,
    ],
    ['epoch', (p: IHostedAdmissionProof) => ({ ...p, epoch: 2 }), /epoch/],
    ['resource', (p: IHostedAdmissionProof) => ({ ...p, resource: 'runtime-1' }), /identity/],
    ['nonce', (p: IHostedAdmissionProof) => ({ ...p, nonce: 'old-challenge' }), /challenge/],
    [
      'expired',
      (p: IHostedAdmissionProof) => ({
        ...p,
        issuedAt: Date.now() - 2000,
        expiresAt: Date.now() - 1,
      }),
      /expired/,
    ],
    ['future', (p: IHostedAdmissionProof) => ({ ...p, issuedAt: Date.now() + 1000 }), /lifetime/],
    ['signature', (p: IHostedAdmissionProof) => ({ ...p, signature: 'A'.repeat(86) }), /signature/],
    [
      'snapshot',
      (p: IHostedAdmissionProof) => ({ ...p, snapshot: { id: 'wrong', digest: 'a'.repeat(64) } }),
      /snapshot/,
    ],
  ] as const)('denies tampered %s proof', async (_name, tamper, expected) => {
    const value = await fixture();
    value.setReplay((proof) => (proof.role === 'worker' ? tamper(proof) : proof));
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: false }),
    ).rejects.toThrow(expected);
  });

  it('denies stale signed epoch information, even with a valid signature', async () => {
    const value = await fixture();
    value.setProofTransform((proof) => ({ ...proof, epoch: 2 }));
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: false }),
    ).rejects.toThrow(/epoch/);
  });

  it('does not replay previously valid proofs', async () => {
    const value = await fixture();
    const captured = new Map<string, IHostedAdmissionProof>();
    value.setReplay((proof) => {
      captured.set(proof.role, proof);
      return proof;
    });
    await admitHostedRuntime({ environment: value.environment, resume: false });
    value.setReplay((proof) => captured.get(proof.role));
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: false }),
    ).rejects.toThrow(/challenge/);
  });

  it('refuses missing broker accounting rather than substituting zero usage', async () => {
    const value = await fixture();
    value.setReplay((proof) => {
      if (proof.role !== 'broker') return proof;
      const copy = { ...proof } as unknown as Record<string, unknown>;
      delete copy.usage;
      return copy;
    });
    await expect(admitHostedRuntime({ environment: value.environment, resume: false })).rejects.toThrow(/proof|usage/u);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses malformed signed accounting: %s', async (modelCalls) => {
    const value = await fixture();
    value.setProofTransform((proof) => proof.role === 'broker'
      ? { ...proof, usage: { ...value.usage(), modelCalls } } : proof);
    await expect(admitHostedRuntime({ environment: value.environment, resume: false })).rejects.toThrow(/usage/u);
  });

  it.each(['worker-accounting', 'missing-accounting', 'wrong-limits', 'tampered-accounting', 'legacy'])(
    'refuses invalid accounting authority: %s', async (fault) => {
      const value = await fixture();
      if (fault === 'worker-accounting') value.setProofTransform((proof) => ({ ...proof, usage: value.usage() }));
      if (fault === 'missing-accounting') value.setProofTransform((proof) => ({ ...proof, usage: null }));
      if (fault === 'wrong-limits') value.setProofTransform((proof) => ({ ...proof, limits: { ...value.config.limits, modelCalls: 999 } }));
      if (fault === 'tampered-accounting') value.setReplay((proof) => proof.role === 'broker'
        ? { ...proof, usage: { ...value.usage(), modelCalls: 1 } } : proof);
      if (fault === 'legacy') value.setReplay((proof) => ({ ...proof, version: 2 }));
      await expect(admitHostedRuntime({ environment: value.environment, resume: false })).rejects.toThrow(/usage|limits|signature|supported/u);
    },
  );

  it('requires a snapshot before any resume request reaches the backends', async () => {
    const value = await fixture();
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: true }),
    ).rejects.toThrow(/resume requires/);
    expect(value.requests()).toBe(0);
  });

  it('binds restored identity to the expected checkpoint digest', async () => {
    const value = await fixture();
    const snapshot = { id: 'checkpoint-1', digest: 'a'.repeat(64) };
    value.writeConfig({ ...value.config, snapshot });
    value.setProofTransform((proof) => ({ ...proof, snapshot }));
    expect(
      (await admitHostedRuntime({ environment: value.environment, resume: true }))?.worker.snapshot,
    ).toEqual(snapshot);
    value.setProofTransform((proof) => ({
      ...proof,
      snapshot: { ...snapshot, digest: 'b'.repeat(64) },
    }));
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: true }),
    ).rejects.toThrow(/snapshot/);
  });

  it('rechecks an early worker proof after a slower broker completes', async () => {
    const value = await fixture();
    value.setProofTransform((proof) =>
      proof.role === 'worker' ? { ...proof, expiresAt: Date.now() + 100 } : proof,
    );
    value.setBrokerDelay(300);
    await expect(
      admitHostedRuntime({ environment: value.environment, resume: false }),
    ).rejects.toThrow(/expired/);
  });
});

describe('operator configuration cannot silently select the local posture', () => {
  it('keeps an explicit local invocation separate', () => {
    expect(readHostedRuntimeConfig({ PRODUCT_RUNTIME_POSTURE: 'local' })).toBeUndefined();
  });
  it('rejects a hosted configuration with a local or unknown posture', () => {
    for (const posture of ['local', 'disabled', undefined]) {
      expect(() =>
        readHostedRuntimeConfig({
          PRODUCT_RUNTIME_POSTURE: posture,
          PRODUCT_HOSTED_RUNTIME_CONFIG: '/not/read',
        }),
      ).toThrow(/cannot opt out/);
    }
  });
  it('rejects missing, corrupt, writable and symlinked configuration', async () => {
    const value = await fixture();
    expect(() =>
      readHostedRuntimeConfig({
        ...value.environment,
        PRODUCT_HOSTED_RUNTIME_CONFIG: join(value.directory, 'missing'),
      }),
    ).toThrow(/missing/);
    writeFileSync(value.file, '{');
    expect(() => readHostedRuntimeConfig(value.environment)).toThrow(/corrupt/);
    value.writeConfig(value.config);
    chmodSync(value.file, 0o666);
    expect(() => readHostedRuntimeConfig(value.environment)).toThrow(/owner-controlled/);
    chmodSync(value.file, 0o600);
    const link = join(value.directory, 'linked');
    symlinkSync(value.file, link);
    expect(() =>
      readHostedRuntimeConfig({ ...value.environment, PRODUCT_HOSTED_RUNTIME_CONFIG: link }),
    ).toThrow(/unreadable/);
  });
  it('rejects disabled/excluded fields and malformed snapshot references', async () => {
    const value = await fixture();
    for (const extra of [{ enabled: false }, { excludedCommands: ['*'] }]) {
      expect(() => decodeHostedRuntimeConfig({ ...value.config, ...extra })).toThrow(
        /unsupported fields/,
      );
    }
    expect(() =>
      decodeHostedRuntimeConfig({
        ...value.config,
        snapshot: { id: 'snapshot', digest: 'not-a-digest' },
      }),
    ).toThrow(/SHA-256/);
  });
  it('rejects plaintext transport, URL credentials, unsupported values and lone surrogates', async () => {
    const value = await fixture();
    for (const endpoint of [
      'http://backend.example.test',
      'https://user:pass@example.test',
      'https://example.test/?token=secret',
    ]) {
      expect(() =>
        decodeHostedRuntimeConfig({
          ...value.config,
          worker: { ...value.config.worker, endpoint },
        }),
      ).toThrow(/TLS/);
    }
    expect(() => decodeHostedRuntimeConfig({ ...value.config, lifetimeMs: Infinity })).toThrow(
      /integer/,
    );
    expect(() =>
      decodeHostedRuntimeConfig({
        ...value.config,
        identity: { ...value.config.identity, task: '\ud800' },
      }),
    ).toThrow(/identifier/);
  });
});
