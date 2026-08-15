import type { IPairingChannel } from './pairing-gate.js';

export function trySendPairingFrame(channel: IPairingChannel, data: string): void {
  try {
    channel.send(data);
  } catch {
    // The peer is gone; pairing frames are best-effort once the carrier is closing.
  }
}

export function tryClosePairingChannel(channel: IPairingChannel): void {
  try {
    channel.close();
  } catch {
    // The carrier is already closing or closed.
  }
}
