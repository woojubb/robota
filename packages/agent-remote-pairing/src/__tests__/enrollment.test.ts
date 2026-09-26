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
  enrollmentCommitment,
  enrollmentSas,
  generateEnrollmentCode,
  newEnrollmentContribution,
  normalizeEnrollmentCode,
  signEnrollmentRequest,
  startEnrollmentProof,
  verifyEnrollmentRequest,
  verifyEnrollmentReveal,
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

  async function request(binding: IEnrollmentBinding, name = 'desktop') {
    const sign = await generateDeviceSignKeyPair(false);
    const ka = await generateDeviceKeyAgreementKeyPair(false);
    const contribution = newEnrollmentContribution();
    return {
      contribution,
      frame: await signEnrollmentRequest({
        binding,
        signPrivateKey: sign.privateKey,
        name,
        signKey: await exportSpki(sign.publicKey),
        kaKey: await exportSpki(ka.publicKey),
        commit: await enrollmentCommitment(binding, contribution),
      }),
    };
  }

  it("the request proves possession of the joiner's signing key over this channel", async () => {
    const { binding } = await proven();
    const { frame } = await request(binding);
    const decoded = decodeEnrollmentFrame(JSON.parse(JSON.stringify(frame)));
    expect(decoded.ok).toBe(true);
    expect(await verifyEnrollmentRequest(binding, frame)).toBe(true);
    expect(await verifyEnrollmentRequest(binding, { ...frame, name: 'laptop' })).toBe(false);
    const other = await proven();
    expect(await verifyEnrollmentRequest(other.binding, frame)).toBe(false);
  });

  it('the commitment opens only with its own contribution, on its own channel', async () => {
    const { binding } = await proven();
    const { frame, contribution } = await request(binding);
    expect(await verifyEnrollmentReveal(binding, frame.commit, contribution)).toBe(true);
    expect(await verifyEnrollmentReveal(binding, frame.commit, newEnrollmentContribution())).toBe(
      false,
    );
    const other = await proven();
    expect(await verifyEnrollmentReveal(other.binding, frame.commit, contribution)).toBe(false);
    // A signed request cannot swap in another commitment.
    const swapped = {
      ...frame,
      commit: await enrollmentCommitment(binding, newEnrollmentContribution()),
    };
    expect(await verifyEnrollmentRequest(binding, swapped)).toBe(false);
  });

  it('refuses a request whose name carries invisible characters', async () => {
    const { binding } = await proven();
    const { frame } = await request(binding, 'desk\u202Etop');
    expect(decodeEnrollmentFrame(JSON.parse(JSON.stringify(frame)))).toEqual({
      ok: false,
      field: 'name',
    });
  });

  it('both sides compute the same six digits, which depend on everything they cover', async () => {
    const { material, binding } = await proven();
    const fields = { name: 'desktop', signKey: 's', kaKey: 'k' };
    const anchor = { masterPublicKey: 'm', userId: 'u' };
    const contributions = {
      joiner: newEnrollmentContribution(),
      existing: newEnrollmentContribution(),
    };
    const sas = await enrollmentSas({ material, binding, request: fields, anchor, contributions });
    expect(sas).toMatch(/^\d{3} \d{3}$/);
    expect(await enrollmentSas({ material, binding, request: fields, anchor, contributions })).toBe(
      sas,
    );
    const variants = await Promise.all([
      enrollmentSas({
        material,
        binding,
        request: fields,
        contributions,
        anchor: { ...anchor, masterPublicKey: 'n' },
      }),
      enrollmentSas({
        material,
        binding,
        anchor,
        contributions,
        request: { ...fields, name: 'laptop' },
      }),
      enrollmentSas({
        material,
        binding,
        request: fields,
        anchor,
        contributions: { ...contributions, existing: newEnrollmentContribution() },
      }),
      enrollmentSas({
        material,
        binding,
        request: fields,
        anchor,
        contributions: { ...contributions, joiner: newEnrollmentContribution() },
      }),
    ]);
    // Each could collide by a one-in-a-million chance; all four colliding would be a defect.
    expect(variants.every((variant) => variant === sas)).toBe(false);
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
    expect(
      decodeEnrollmentFrame({
        t: 'en-anchor',
        masterPublicKey: 'x',
        userId: 'y',
        contribution: 'z',
      }),
    ).toEqual({ ok: false, field: 'masterPublicKey' });
    expect(decodeEnrollmentFrame({ t: 'en-reveal', contribution: 'short' })).toEqual({
      ok: false,
      field: 'contribution',
    });
    expect(decodeEnrollmentFrame({ t: 'en-grant' })).toMatchObject({ ok: false });
    expect(decodeEnrollmentFrame('nope')).toEqual({ ok: false, field: 'frame' });
  });
});
