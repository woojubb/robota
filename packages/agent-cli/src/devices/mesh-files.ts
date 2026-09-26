/**
 * Files between this device and another of the user's devices, over their admitted mesh link.
 *
 * Each transfer runs on a data channel of its own, never the one messages use. What arrives is
 * decided by the link's own authority — the operator here is asked about every file — and kept aside
 * under this `HOME`, in a directory for the sending device.
 */

import { randomUUID } from 'node:crypto';

import {
  receiveFileOverChannel,
  sendFileOverChannel,
  type TFileReceiveOutcome,
} from '@robota-sdk/agent-transport/node';

import { describeFileRefusal, fileReceiving } from '../peer-files/receiving.js';

import type { IOutgoingFile } from '../peer-files/outgoing-file.js';
import type { IDeviceMeshLink } from '@robota-sdk/agent-transport-webrtc';

export interface IDeviceFileReceiving {
  /** `~/.robota` of this device's `HOME`. */
  readonly root: string;
  readonly maxBytes?: number;
  /** Told how each offered file ended. */
  readonly onOutcome?: (outcome: TFileReceiveOutcome, deviceId: string) => void;
}

/** Take the files the peer on `link` sends. Returns an unsubscribe. */
export function acceptDeviceFiles(
  link: IDeviceMeshLink,
  options: IDeviceFileReceiving,
): () => void {
  const deviceId = link.admission.deviceId;
  const receiving = fileReceiving({
    root: options.root,
    senderId: deviceId,
    authority: link.authority,
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
  });
  return link.onFileChannel((channel) => {
    // Called now, not after a turn of the event loop: the carrier must listen before the offer lands.
    void receiveFileOverChannel({ ...receiving, channel }).then((outcome) =>
      options.onOutcome?.(outcome, deviceId),
    );
  });
}

/** How a send to a device ended. */
export interface IDeviceFileSendResult {
  readonly state: 'delivered' | 'refused' | 'failed';
  readonly reason?: string;
}

/** Send a prepared file's content to the device on `link`. */
export async function sendFileToDevice(
  link: IDeviceMeshLink,
  file: IOutgoingFile,
): Promise<IDeviceFileSendResult> {
  let channel;
  try {
    channel = await link.openFileChannel();
  } catch (error) {
    return { state: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  const outcome = await sendFileOverChannel({
    channel,
    offer: { transferId: randomUUID(), name: file.name, size: file.size, sha256: file.sha256 },
    source: file.source,
  });
  if (outcome.ok) return { state: 'delivered' };
  const refusedThere =
    outcome.reason !== 'closed' && outcome.reason !== 'timeout' && outcome.reason !== 'unavailable';
  return {
    state: refusedThere ? 'refused' : 'failed',
    reason: describeFileRefusal(outcome.reason, outcome.detail),
  };
}
