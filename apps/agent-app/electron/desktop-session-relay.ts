import {
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
  MAX_INBOUND_FRAME_BYTES,
} from '@robota-sdk/agent-transport/client';

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';
import type { IpcMainEvent, MessageChannelMain, MessageEvent, WebContents } from 'electron';

const PORT_CHANNEL = 'desktop-session:port';
const MAX_OUTSTANDING = 32;
const active = new WeakMap<WebContents, () => void>();

interface ISessionChannel {
  send(message: TClientMessage): void;
  onMessage(listener: (message: TServerMessage) => void): () => void;
}

interface IRelayOptions {
  sender: WebContents;
  source: Pick<IpcMainEvent, 'sender' | 'senderFrame'>;
  session: ISessionChannel;
  signal: AbortSignal;
  isCurrent: () => boolean;
  createChannel: () => MessageChannelMain;
}

function fits(frame: string): boolean {
  return (
    frame.length <= MAX_INBOUND_FRAME_BYTES &&
    Buffer.byteLength(frame, 'utf8') <= MAX_INBOUND_FRAME_BYTES
  );
}

/** Transfer a session-only port to one admitted top frame. Owner operations never enter this relay. */
export function openDesktopSessionRelay(options: IRelayOptions): { dispose: () => void } {
  const { sender, source, session, signal, isCurrent } = options;
  const frame = sender.mainFrame;
  if (
    signal.aborted ||
    sender.isDestroyed() ||
    source.sender !== sender ||
    source.senderFrame !== frame ||
    !isCurrent() ||
    active.has(sender)
  ) {
    throw new Error('The desktop session frame is not eligible for a relay.');
  }
  const { port1, port2 } = options.createChannel();
  let closed = false;
  let releaseSession: (() => void) | undefined;
  let incomingSeq = 0;
  let outgoingSeq = 0;
  const pending = new Set<number>();

  function dispose(): void {
    if (closed) return;
    closed = true;
    active.delete(sender);
    sender.removeListener('destroyed', dispose);
    sender.removeListener('did-start-navigation', onNavigation);
    sender.removeListener('render-process-gone', dispose);
    signal.removeEventListener('abort', dispose);
    port1.removeListener('message', onMessage);
    port1.removeListener('close', dispose);
    releaseSession?.();
    pending.clear();
    port1.close();
  }

  function validGeneration(): boolean {
    try {
      return (
        !closed &&
        !signal.aborted &&
        !sender.isDestroyed() &&
        sender.mainFrame === frame &&
        isCurrent()
      );
    } catch {
      return false;
    }
  }

  function onNavigation(details: { isMainFrame: boolean }): void {
    if (details.isMainFrame) dispose();
  }

  function onMessage(event: MessageEvent): void {
    if (!validGeneration() || event.ports.length !== 0) {
      dispose();
      return;
    }
    const value: unknown = event.data;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('kind' in value) ||
      !('seq' in value) ||
      typeof value.seq !== 'number' ||
      !Number.isSafeInteger(value.seq)
    ) {
      dispose();
      return;
    }
    if (value.kind === 'ack') {
      if (!pending.delete(value.seq)) dispose();
      return;
    }
    if (
      value.kind !== 'frame' ||
      value.seq !== incomingSeq + 1 ||
      !('frame' in value) ||
      typeof value.frame !== 'string' ||
      !fits(value.frame)
    ) {
      dispose();
      return;
    }
    const decoded = decodeFrame(value.frame, decodeClientMessage);
    if (!decoded.ok) {
      dispose();
      return;
    }
    incomingSeq = value.seq;
    try {
      session.send(decoded.message);
      if (validGeneration()) port1.postMessage({ kind: 'ack', seq: value.seq });
      else dispose();
    } catch {
      dispose();
    }
  }

  active.set(sender, dispose);
  sender.on('destroyed', dispose);
  sender.on('did-start-navigation', onNavigation);
  sender.on('render-process-gone', dispose);
  signal.addEventListener('abort', dispose, { once: true });
  port1.on('message', onMessage);
  port1.on('close', dispose);
  try {
    if (!validGeneration()) throw new Error('Session admission is no longer current.');
    releaseSession = session.onMessage((message) => {
      if (!validGeneration()) {
        dispose();
        return;
      }
      try {
        const decoded = decodeServerMessage(message);
        const frameText = JSON.stringify(message);
        if (!decoded.ok || !fits(frameText) || pending.size >= MAX_OUTSTANDING) {
          dispose();
          return;
        }
        const seq = ++outgoingSeq;
        pending.add(seq);
        port1.postMessage({ kind: 'frame', seq, frame: frameText });
      } catch {
        dispose();
      }
    });
    if (closed) {
      releaseSession();
      throw new Error('Session relay closed during initialization.');
    }
    port1.start();
    frame.postMessage(PORT_CHANNEL, null, [port2]);
  } catch (error) {
    dispose();
    port2.close();
    throw error;
  }
  return { dispose };
}
