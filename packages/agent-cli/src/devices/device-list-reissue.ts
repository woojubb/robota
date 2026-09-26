/**
 * A signing-key holder reissues the roster and revocation list before they expire.
 *
 * Both lists are valid for a day so a withheld list and a stale one cannot be told apart for long;
 * that only works if the device holding the signing key keeps issuing fresh ones. Reissuing carries
 * the same content forward under a higher sequence number and needs no operator: the signing key is
 * what the device keeps for exactly this, and nothing here touches the recovery phrase.
 */
import { join } from 'node:path';

import { issueDeviceRevocationList, issueDeviceRoster } from '@robota-sdk/agent-remote-pairing';

import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { loadSigningKey } from './identity-keys.js';
import { checked, nextSeq } from './identity-lists.js';
import { readIdentityState, writeIdentityState } from './identity-state.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

const HOUR_MS = 60 * 60 * 1000;
/** Reissue once less than this is left, so an hourly check never lets a list lapse. */
export const LIST_REISSUE_MARGIN_MS = 6 * HOUR_MS;
/** How often a running host checks. */
export const LIST_REISSUE_CHECK_MS = HOUR_MS;

export type TListReissueOutcome =
  | 'reissued'
  | 'not-due'
  | 'not-initialized'
  /** This device does not keep the signing key; another device reissues. */
  | 'not-holder'
  /** The state says this device holds it, but the credential store does not have it. */
  | 'no-signing-key'
  /** Only `/devices recover` issues a new signing key. */
  | 'signing-key-expired';

export interface IDeviceListReissueOptions {
  /** Where the identity state is kept, e.g. `~/.robota/devices`. */
  readonly directory: string;
  readonly withinRoot?: string;
  readonly store: ICredentialStore;
  readonly now?: () => number;
}

/** Reissue the roster and revocation list when they are due. */
export async function reissueDueLists(
  options: IDeviceListReissueOptions,
): Promise<TListReissueOutcome> {
  const now = options.now ?? Date.now;
  const due = (): TListReissueOutcome | undefined => {
    const state = readIdentityState(options.directory);
    if (state === undefined) return 'not-initialized';
    if (!state.holdsSigningKey) return 'not-holder';
    const expiresAt = Math.min(state.roster.expiresAt, state.revocation.expiresAt);
    return expiresAt - now() > LIST_REISSUE_MARGIN_MS ? 'not-due' : undefined;
  };
  // Most checks end here, without the lock or the credential store.
  const early = due();
  if (early !== undefined) return early;

  return withExclusiveFileLock(join(options.directory, 'identity.lock'), async () => {
    const again = due();
    if (again !== undefined) return again;
    const current = readIdentityState(options.directory);
    if (current === undefined) return 'not-initialized';
    const signingKey = await loadSigningKey(options.store, current.signingKeyCertificate);
    if (signingKey === undefined) return 'no-signing-key';
    const issuedAt = now();
    if (issuedAt >= signingKey.certificate.expiresAt) return 'signing-key-expired';
    const marks = current.marks.bySigningKey?.[current.signingKeyCertificate.signingKeyId];
    const state = await checked(
      {
        ...current,
        roster: await issueDeviceRoster({
          signingKey,
          seq: nextSeq(Math.max(current.roster.seq, marks?.rosterSeq ?? 0), issuedAt),
          issuedAt,
          devices: current.roster.devices,
        }),
        revocation: await issueDeviceRevocationList({
          signingKey,
          seq: nextSeq(Math.max(current.revocation.seq, marks?.revocationSeq ?? 0), issuedAt),
          issuedAt,
          revokedDeviceIds: current.revocation.revokedDeviceIds,
        }),
      },
      issuedAt,
    );
    writeIdentityState(options.directory, state, options.withinRoot);
    return 'reissued';
  });
}

/**
 * Check now and then hourly while the host runs. The timer never holds the process open. A failed
 * check is retried on the next tick; `onError` hears about it. `onReissued` hears of new lists, for
 * a running mesh to push them.
 */
export function scheduleListReissue(
  options: IDeviceListReissueOptions & {
    readonly intervalMs?: number;
    readonly onError?: (error: unknown) => void;
    readonly onReissued?: () => void;
  },
): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    reissueDueLists(options)
      .then((outcome) => {
        if (outcome === 'reissued') options.onReissued?.();
      })
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, options.intervalMs ?? LIST_REISSUE_CHECK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
