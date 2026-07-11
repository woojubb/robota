/**
 * Mutual trusted-device reconnect handshake (REMOTE-012 Stage E3) — the dual of the B3 first-pair handshake,
 * but authenticating a previously-pinned device/host pair by asymmetric signatures instead of a shared
 * secret. Transport-agnostic: the caller supplies `send` and feeds inbound frames via `onFrame`; the returned
 * promise is the ONLY accept signal, and the caller MUST close the channel if it rejects (fail closed).
 *
 * Both sides sign the same channel-bound transcript (`signChallenge`) and each verifies the OTHER against a
 * pinned public key BEFORE accepting — so the device will not co-drive a rogue host, and the host will not
 * expose a session to an unpinned device. Directionality is intrinsic to the distinct keypairs.
 *
 * Frames: device→host `rc-hello{deviceId,nonceDevice}` → host→device `rc-host{nonceHost,sig}` →
 * device→host `rc-device{sig}`.
 */
import { signChallenge, verifyChallenge, type IReconnectChallenge } from './device-identity.js';
import { generateNonce } from './pairing.js';

export type TReconnectFrame =
  | { readonly t: 'rc-hello'; readonly deviceId: string; readonly nonceDevice: string }
  | { readonly t: 'rc-host'; readonly nonceHost: string; readonly sig: string }
  | { readonly t: 'rc-device'; readonly sig: string };

export interface IReconnectResult {
  /** The device that authenticated (the host learns which pinned device connected). */
  readonly deviceId: string;
}

export interface IReconnectController {
  /** Resolves accept (after verifying the counterpart) or rejects (caller must close the channel). */
  readonly result: Promise<IReconnectResult>;
  /** Feed one inbound frame from the data channel. */
  onFrame(frame: TReconnectFrame): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface ISettle {
  fail(message: string): void;
  succeed(result: IReconnectResult): void;
  settled(): boolean;
}

function makeSettle(
  resolve: (r: IReconnectResult) => void,
  reject: (e: Error) => void,
  timeoutMs: number,
): ISettle {
  let done = false;
  const timer = setTimeout(() => {
    if (!done) {
      done = true;
      reject(new Error('reconnect handshake timed out'));
    }
  }, timeoutMs);
  return {
    fail(message: string): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(message));
    },
    succeed(result: IReconnectResult): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    },
    settled: () => done,
  };
}

export interface IDeviceReconnectOptions {
  readonly deviceId: string;
  readonly hostIdentityId: string;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  /** This device's non-extractable private key. */
  readonly devicePrivateKey: CryptoKey;
  /** The host public key this device pinned at first pair. */
  readonly pinnedHostPublicKey: CryptoKey;
  readonly send: (frame: TReconnectFrame) => void;
  readonly timeoutMs?: number;
}

/**
 * Device side. Emits `rc-hello`, then on `rc-host` verifies the host against the pinned host key (fail-closed
 * on a rogue/absent host signature), signs its own proof, sends `rc-device`, and accepts.
 */
export function startDeviceReconnect(options: IDeviceReconnectOptions): IReconnectController {
  const nonceDevice = generateNonce();
  let resolve!: (r: IReconnectResult) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<IReconnectResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const settle = makeSettle(resolve, reject, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  options.send({ t: 'rc-hello', deviceId: options.deviceId, nonceDevice });

  return {
    result,
    onFrame(frame: TReconnectFrame): void {
      if (settle.settled() || frame.t !== 'rc-host') return;
      void (async (): Promise<void> => {
        const challenge: IReconnectChallenge = {
          deviceId: options.deviceId,
          hostIdentityId: options.hostIdentityId,
          nonceHost: frame.nonceHost,
          nonceDevice,
          localFingerprint: options.localFingerprint,
          remoteFingerprint: options.remoteFingerprint,
        };
        const hostOk = await verifyChallenge(options.pinnedHostPublicKey, frame.sig, challenge);
        if (settle.settled()) return;
        if (!hostOk) {
          settle.fail('reconnect rejected: host authentication failed (possible rogue host)');
          return;
        }
        const sig = await signChallenge(options.devicePrivateKey, challenge);
        if (settle.settled()) return;
        options.send({ t: 'rc-device', sig });
        settle.succeed({ deviceId: options.deviceId });
      })();
    },
  };
}

export interface IHostReconnectOptions {
  readonly hostIdentityId: string;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  /** The host's identity private key (signs the challenge). */
  readonly hostPrivateKey: CryptoKey;
  /** Resolve the pinned device public key for a `deviceId`, or undefined if unknown/revoked (→ fail closed). */
  readonly resolveDevicePublicKey: (deviceId: string) => Promise<CryptoKey | undefined>;
  readonly send: (frame: TReconnectFrame) => void;
  readonly timeoutMs?: number;
}

/**
 * Host side. On `rc-hello` it looks up the pinned device key (unknown → fail closed), signs and sends
 * `rc-host`, then on `rc-device` verifies the device proof and accepts.
 */
export function startHostReconnect(options: IHostReconnectOptions): IReconnectController {
  let resolve!: (r: IReconnectResult) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<IReconnectResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const settle = makeSettle(resolve, reject, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let pending:
    | { deviceId: string; devicePublicKey: CryptoKey; challenge: IReconnectChallenge }
    | undefined;

  return {
    result,
    onFrame(frame: TReconnectFrame): void {
      if (settle.settled()) return;
      if (frame.t === 'rc-hello') {
        void (async (): Promise<void> => {
          const devicePublicKey = await options.resolveDevicePublicKey(frame.deviceId);
          if (settle.settled()) return;
          if (!devicePublicKey) {
            settle.fail('reconnect rejected: unknown or revoked device');
            return;
          }
          const nonceHost = generateNonce();
          const challenge: IReconnectChallenge = {
            deviceId: frame.deviceId,
            hostIdentityId: options.hostIdentityId,
            nonceHost,
            nonceDevice: frame.nonceDevice,
            localFingerprint: options.localFingerprint,
            remoteFingerprint: options.remoteFingerprint,
          };
          const sig = await signChallenge(options.hostPrivateKey, challenge);
          if (settle.settled()) return;
          pending = { deviceId: frame.deviceId, devicePublicKey, challenge };
          options.send({ t: 'rc-host', nonceHost, sig });
        })();
      } else if (frame.t === 'rc-device') {
        const current = pending;
        if (!current) {
          settle.fail('reconnect rejected: rc-device before rc-hello');
          return;
        }
        void (async (): Promise<void> => {
          const deviceOk = await verifyChallenge(
            current.devicePublicKey,
            frame.sig,
            current.challenge,
          );
          if (settle.settled()) return;
          if (!deviceOk) {
            settle.fail('reconnect rejected: device authentication failed');
            return;
          }
          settle.succeed({ deviceId: current.deviceId });
        })();
      }
    },
  };
}
