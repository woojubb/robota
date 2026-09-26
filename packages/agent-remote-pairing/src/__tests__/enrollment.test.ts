import { describe, expect, it } from 'vitest';

import {
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
} from '../identity/certificates.js';
import { exportSpki } from '../identity/encoding.js';
import {
  EnrollmentError,
  decodeEnrollmentFrame,
  deriveEnrollmentMaterial,
  enrollmentSas,
  generateEnrollmentCode,
  normalizeEnrollmentCode,
  signEnrollmentRequest,
  startEnrollmentProof,
  verifyEnrollmentRequest,
  type IEnrollmentBinding,
  type IEnrollmentMaterial,
  type TEnrollmentProofFrame,
  type TEnrollmentRole,
} from '../identity/enrollment.js';

const FP_J = 'AA:AA:AA:AA';
const FP_E = 'BB:BB:BB:BB';
const FP_R1 = 'C1:C1:C1:C1';
const FP_R2 = 'C2:C2:C2:C2';

async function refusal(promise: Promise<unknown>): Promise<EnrollmentError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EnrollmentError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

interface ISide {
  readonly role: TEnrollmentRole;
  readonly material: IEnrollmentMaterial;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
}

/** Two sides wired to each other; `tap` sees (and may rewrite) every frame in flight. */
function run(joiner: ISide, existing: ISide, timeoutMs = 500) {
  const sent: { joiner: TEnrollmentProofFrame[]; existing: TEnrollmentProofFrame[] } = {
    joiner: [],
    existing: [],
  };
  let toExisting: (frame: unknown) => void = () => undefined;
  let toJoiner: (frame: unknown) => void = () => undefined;
  const j = startEnrollmentProof({
    ...joiner,
    timeoutMs,
    send: (frame) => {
      sent.joiner.push(frame);
      queueMicrotask(() => toExisting(JSON.parse(JSON.stringify(frame))));
    },
  });
  const e = startEnrollmentProof({
    ...existing,
    timeoutMs,
    send: (frame) => {
      sent.existing.push(frame);
      queueMicrotask(() => toJoiner(JSON.parse(JSON.stringify(frame))));
    },
  });
  toExisting = (frame) => e.onFrame(frame);
  toJoiner = (frame) => j.onFrame(frame);
  return { joiner: j.result, existing: e.result, sent };
}

describe('enrollment code', () => {
  it('is 125 random bits in five groups, and reads back however it is typed', () => {
    const code = generateEnrollmentCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    expect(generateEnrollmentCode()).not.toBe(code);
    const canonical = code.replace(/-/g, '');
    expect(normalizeEnrollmentCode(code)).toBe(canonical);
    expect(normalizeEnrollmentCode(` ${code.toLowerCase().replace(/-/g, ' ')} `)).toBe(canonical);
  });

  it('reads the look-alike letters as the digits they stand for, and refuses anything else', () => {
    expect(normalizeEnrollmentCode('OOOOO-IIIII-LLLLL-00000-11111')).toBe(
      '0000011111111110000011111',
    );
    expect(normalizeEnrollmentCode('ABCDE-FGHJK-MNPQR-STVWX-YZ01')).toBeUndefined();
    expect(normalizeEnrollmentCode('ABCDE-FGHJK-MNPQR-STVWX-YZ01U')).toBeUndefined();
    expect(normalizeEnrollmentCode('laptop')).toBeUndefined();
  });

  it('derives two relay topics, one per direction, that name nothing and differ per code', async () => {
    const code = generateEnrollmentCode();
    const a = await deriveEnrollmentMaterial(code);
    const again = await deriveEnrollmentMaterial(code.toLowerCase());
    const other = await deriveEnrollmentMaterial(generateEnrollmentCode());
    expect(a.existingInbox).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.joinerInbox).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.existingInbox).not.toBe(a.joinerInbox);
    expect(again.existingInbox).toBe(a.existingInbox);
    expect(other.existingInbox).not.toBe(a.existingInbox);
    expect(a.existingInbox).not.toContain(code.replace(/-/g, ''));
    await expect(deriveEnrollmentMaterial('not a code')).rejects.toThrow(/code/);
  });
});

describe('enrollment proof — knowledge of the code, bound to the negotiated channel', () => {
  it('both sides prove the code over the same fingerprints and agree on the binding', async () => {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const { joiner, existing } = run(
      { role: 'joiner', material, localFingerprint: FP_J, remoteFingerprint: FP_E },
      { role: 'existing', material, localFingerprint: FP_E, remoteFingerprint: FP_J },
    );
    const [j, e] = await Promise.all([joiner, existing]);
    expect(j).toEqual(e);
    expect(j.fingerprintJoiner).toBe(FP_J);
    expect(j.fingerprintExisting).toBe(FP_E);
  });

  it('refuses a relay in the middle: each side sees the relay, so neither proof verifies', async () => {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const { joiner, existing } = run(
      { role: 'joiner', material, localFingerprint: FP_J, remoteFingerprint: FP_R1 },
      { role: 'existing', material, localFingerprint: FP_E, remoteFingerprint: FP_R2 },
    );
    expect((await refusal(existing)).reason).toBe('proof-failed');
    expect((await refusal(joiner)).reason).toBe('proof-failed');
  });

  it('refuses a wrong code', async () => {
    const right = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const wrong = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const { joiner, existing } = run(
      { role: 'joiner', material: wrong, localFingerprint: FP_J, remoteFingerprint: FP_E },
      { role: 'existing', material: right, localFingerprint: FP_E, remoteFingerprint: FP_J },
    );
    expect((await refusal(existing)).reason).toBe('proof-failed');
    expect((await refusal(joiner)).reason).toBe('proof-failed');
  });

  it("refuses a side's own proof reflected back to it", async () => {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const sent: TEnrollmentProofFrame[] = [];
    let feed: (frame: unknown) => void = () => undefined;
    const existing = startEnrollmentProof({
      role: 'existing',
      material,
      localFingerprint: FP_E,
      remoteFingerprint: FP_J,
      timeoutMs: 500,
      send: (frame) => {
        sent.push(frame);
        // A mirror: every frame comes straight back.
        queueMicrotask(() => feed(JSON.parse(JSON.stringify(frame))));
      },
    });
    feed = (frame) => existing.onFrame(frame);
    expect((await refusal(existing.result)).reason).toBe('proof-failed');
  });

  it('takes nothing but its nonce and proof before the proof passes', async () => {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const existing = startEnrollmentProof({
      role: 'existing',
      material,
      localFingerprint: FP_E,
      remoteFingerprint: FP_J,
      timeoutMs: 500,
      send: () => undefined,
    });
    existing.onFrame({ t: 'en-request', name: 'x', signKey: 'x', kaKey: 'x', sig: 'x' });
    expect((await refusal(existing.result)).reason).toBe('malformed-frame');
  });

  it('times out when the peer never proves', async () => {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const existing = startEnrollmentProof({
      role: 'existing',
      material,
      localFingerprint: FP_E,
      remoteFingerprint: FP_J,
      timeoutMs: 50,
      send: () => undefined,
    });
    expect((await refusal(existing.result)).reason).toBe('timeout');
  });
});

describe('enrollment request and short authentication string', () => {
  async function proven(): Promise<{ material: IEnrollmentMaterial; binding: IEnrollmentBinding }> {
    const material = await deriveEnrollmentMaterial(generateEnrollmentCode());
    const { joiner } = run(
      { role: 'joiner', material, localFingerprint: FP_J, remoteFingerprint: FP_E },
      { role: 'existing', material, localFingerprint: FP_E, remoteFingerprint: FP_J },
    );
    return { material, binding: await joiner };
  }

  it("the request proves possession of the joiner's signing key over this channel", async () => {
    const { binding } = await proven();
    const sign = await generateDeviceSignKeyPair(false);
    const ka = await generateDeviceKeyAgreementKeyPair(false);
    const request = await signEnrollmentRequest({
      binding,
      signPrivateKey: sign.privateKey,
      name: 'desktop',
      signKey: await exportSpki(sign.publicKey),
      kaKey: await exportSpki(ka.publicKey),
    });
    const decoded = decodeEnrollmentFrame(JSON.parse(JSON.stringify(request)));
    expect(decoded.ok).toBe(true);
    expect(await verifyEnrollmentRequest(binding, request)).toBe(true);
    expect(await verifyEnrollmentRequest(binding, { ...request, name: 'laptop' })).toBe(false);
    const other = await proven();
    expect(await verifyEnrollmentRequest(other.binding, request)).toBe(false);
  });

  it('both sides compute the same six digits, which change with the master key they name', async () => {
    const { material, binding } = await proven();
    const request = { name: 'desktop', signKey: 's', kaKey: 'k' };
    const anchor = { masterPublicKey: 'm', userId: 'u' };
    const sas = await enrollmentSas({ material, binding, request, anchor });
    expect(sas).toMatch(/^\d{3} \d{3}$/);
    expect(await enrollmentSas({ material, binding, request, anchor })).toBe(sas);
    const swapped = await enrollmentSas({
      material,
      binding,
      request,
      anchor: { ...anchor, masterPublicKey: 'n' },
    });
    const renamed = await enrollmentSas({
      material,
      binding,
      request: { ...request, name: 'laptop' },
      anchor,
    });
    // One in a million could collide by chance; both colliding would be a defect.
    expect(swapped === sas && renamed === sas).toBe(false);
  });

  it('decodes each frame strictly and names the field, never the value', () => {
    expect(decodeEnrollmentFrame({ t: 'en-declined' })).toEqual({
      ok: true,
      frame: { t: 'en-declined' },
    });
    expect(decodeEnrollmentFrame({ t: 'en-declined', extra: 1 })).toEqual({
      ok: false,
      field: 'frame',
    });
    expect(decodeEnrollmentFrame({ t: 'en-anchor', masterPublicKey: 'x', userId: 'y' })).toEqual({
      ok: false,
      field: 'masterPublicKey',
    });
    expect(decodeEnrollmentFrame({ t: 'en-grant' })).toMatchObject({ ok: false });
    expect(decodeEnrollmentFrame('nope')).toEqual({ ok: false, field: 'frame' });
  });
});
