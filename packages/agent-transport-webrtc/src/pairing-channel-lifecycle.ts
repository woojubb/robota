import type { IPairingChannel } from './pairing-gate.js';

function send(channel: IPairingChannel, data: string): void {
  try {
    channel.send(data);
  } catch {
    // The peer is gone; pairing frames are best-effort once the carrier is closing.
  }
}

function close(channel: IPairingChannel): void {
  try {
    channel.close();
  } catch {
    // The carrier is already closing or closed.
  }
}

function reportDeliveryError(
  callback: ((error: Error, event: string) => void) | undefined,
  error: Error,
  event: string,
): void {
  try {
    callback?.(error, event);
  } catch {
    // A diagnostic callback cannot prevent carrier teardown or escape into the committed operation.
  }
}

export const pairingChannel = Object.freeze({ send, close, reportDeliveryError });
