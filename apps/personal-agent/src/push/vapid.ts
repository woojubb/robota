/**
 * The key pair (VAPID) that identifies this agent to a browser's push service. It is made the first
 * time it is needed and kept in an owner-only file of its own: the private half signs what the agent
 * sends and is never returned by any route, never written to a log and never named in an error; the
 * public half is what a browser needs to subscribe, so it is the only part the page can ask for.
 *
 * A subscription belongs to the key it was made with, so a key pair made anew leaves every earlier
 * subscription unable to take a push; they are forgotten rather than kept to fail without saying why.
 */
import webPush from 'web-push';

import { DeliveryRefusedError } from '@robota-sdk/agent-product/personal';

import { createOwnerFile } from './owner-file.js';

/**
 * Who a push service may contact about this sender. The usual form is a `mailto:` address, but that
 * would be the person's own, so it is the project's documentation site, an `https` address the
 * standard allows in the same place. Nothing about the person goes into it.
 */
export const VAPID_SUBJECT = 'https://docs.robota.io/';

export interface IVapidKeys {
  /** URL-safe base64 of the 65-byte uncompressed public key. */
  readonly publicKey: string;
  /** URL-safe base64 of the 32-byte private key; only ever used to sign what the agent sends. */
  readonly privateKey: string;
}

export interface IVapid {
  /** The pair, made and kept the first time it is asked for. */
  keys(): IVapidKeys;
}

const FILE = 'vapid.json';

function keyBytes(value: unknown, length: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  return Buffer.from(value, 'base64url').length === length;
}

/** The pair as stored, or `undefined` when the file is not what this module writes. */
function keysOf(raw: unknown): IVapidKeys | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { publicKey, privateKey } = raw as Record<string, unknown>;
  return keyBytes(publicKey, 65) && keyBytes(privateKey, 32)
    ? { publicKey, privateKey }
    : undefined;
}

/** `onCreated` runs when a pair is made, before it is kept: whatever was bound to an earlier pair goes. */
export function createVapid(directory: string, onCreated: () => void = () => undefined): IVapid {
  const file = createOwnerFile(directory, FILE);
  let held: IVapidKeys | undefined;
  const unusable = (): DeliveryRefusedError =>
    new DeliveryRefusedError(
      `The push key file cannot be used; remove ${file.path} to make a new one, then turn push on again`,
    );
  return {
    keys: () => {
      if (held !== undefined) return held;
      let stored: unknown;
      try {
        stored = file.read();
      } catch {
        // The cause of a failed parse can quote the file; the person is told which file to look at.
        throw unusable();
      }
      if (stored === undefined) {
        const made = webPush.generateVAPIDKeys();
        onCreated();
        file.write({ publicKey: made.publicKey, privateKey: made.privateKey });
        held = { publicKey: made.publicKey, privateKey: made.privateKey };
        return held;
      }
      const checked = keysOf(stored);
      if (checked === undefined) throw unusable();
      held = checked;
      return held;
    },
  };
}
