/**
 * Files, and sessions handed over, between this device and another of the user's devices, over their
 * admitted mesh link.
 *
 * Each transfer runs on a data channel of its own, never the one messages use. What arrives is
 * decided by the link's own authority — the operator here is asked about every file and every
 * session — and kept aside under this `HOME`, in a directory for the sending device. A session is
 * only ever pushed by the device that holds it.
 */

import { randomUUID } from 'node:crypto';

import {
  receiveFileOverChannel,
  sendFileOverChannel,
  type TFileReceiveOutcome,
} from '@robota-sdk/agent-transport/node';

import { dtlsCarrierBinding } from '../handoff/handoff-grant.js';
import {
  pushHandoff,
  type IPushHandoffOptions,
  type IPushHandoffResult,
} from '../handoff/handoff-push.js';
import { describeFileRefusal, fileReceiving } from '../peer-files/receiving.js';

import type { IHandoffArrival } from '../handoff/handoff-receiving.js';
import type { TReceiveHandoffOutcome } from '../handoff/handoff-receive.js';
import type { IOutgoingFile } from '../peer-files/outgoing-file.js';
import type { IFileFrameChannel } from '@robota-sdk/agent-interface-session-mobility';
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
  return acceptDeviceChannels(link, { files: options });
}

/** Taking a session another device pushes. */
export interface IDeviceHandoffReceiving {
  /** This device, as a grant must name it. */
  readonly deviceId: string;
  /** Built once per device; it remembers the transfers it saved. */
  readonly receive: (arrival: IHandoffArrival) => Promise<TReceiveHandoffOutcome>;
  /** Told how each pushed session ended. */
  readonly onOutcome?: (outcome: TReceiveHandoffOutcome, deviceId: string) => void;
}

/**
 * Take what the peer on `link` opens a channel for: a file, or a session it pushes. The first frame
 * says which; a channel that is neither, or one this side does not take, is closed unread. Returns an
 * unsubscribe.
 */
export function acceptDeviceChannels(
  link: IDeviceMeshLink,
  options: { readonly files?: IDeviceFileReceiving; readonly handoff?: IDeviceHandoffReceiving },
): () => void {
  const deviceId = link.admission.deviceId;
  const files = options.files;
  const receiving =
    files === undefined
      ? undefined
      : fileReceiving({
          root: files.root,
          senderId: deviceId,
          authority: link.authority,
          ...(files.maxBytes !== undefined ? { maxBytes: files.maxBytes } : {}),
        });
  const handoff = options.handoff;
  return link.onFileChannel((channel) => {
    // Subscribed now, not after a turn of the event loop: the first frame may already be on its way.
    const stop = channel.onFrame((first) => {
      stop();
      // Routed once this delivery is over, so the receiver's own subscription cannot be handed this
      // same frame by it as well; the next frame cannot arrive before a microtask runs.
      queueMicrotask(() => route(first));
    });
    const route = (first: string): void => {
      const replayed = replayingFirst(channel, first);
      const kind = firstFrameKind(first);
      // Each receiver subscribes as it is called, before the frame after this one can arrive.
      if (kind === 'file' && receiving !== undefined) {
        void receiveFileOverChannel({ ...receiving, channel: replayed }).then((outcome) =>
          files?.onOutcome?.(outcome, deviceId),
        );
        return;
      }
      if (kind === 'handoff' && handoff !== undefined) {
        void handoff
          .receive({
            channel: replayed,
            carrierBinding: dtlsCarrierBinding(link.channelBinding.localFingerprint),
            destinationId: handoff.deviceId,
            sourceId: deviceId,
            signerDeviceId: deviceId,
            senderDirectory: deviceId,
            authority: link.authority,
          })
          .then((outcome) => handoff.onOutcome?.(outcome, deviceId));
        return;
      }
      channel.close();
    };
  });
}

/** Which receiver a channel's first frame is for. */
function firstFrameKind(frame: string): 'file' | 'handoff' | undefined {
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return undefined;
  }
  const t = typeof value === 'object' && value !== null ? (value as { t?: unknown }).t : undefined;
  if (t === 'file-offer') return 'file';
  if (typeof t === 'string' && t.startsWith('handoff-')) return 'handoff';
  return undefined;
}

/** `channel`, with `first` delivered again to whoever subscribes first. */
function replayingFirst(channel: IFileFrameChannel, first: string): IFileFrameChannel {
  let pending: string | undefined = first;
  return {
    send: (frame) => channel.send(frame),
    onFrame: (handler) => {
      const stop = channel.onFrame(handler);
      const replay = pending;
      pending = undefined;
      if (replay !== undefined) queueMicrotask(() => handler(replay));
      return stop;
    },
    onClose: (handler) => channel.onClose(handler),
    close: () => channel.close(),
  };
}

/** Push this device's session to the device on `link`. Its operator there is asked first. */
export function handoffToDevice(
  link: IDeviceMeshLink,
  options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'>,
): Promise<IPushHandoffResult> {
  return pushHandoff({
    ...options,
    openChannel: () => link.openFileChannel(),
    // The receiver's end of this connection: the fingerprint this side's DTLS layer verified for it.
    carrierBinding: dtlsCarrierBinding(link.channelBinding.remoteFingerprint),
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
