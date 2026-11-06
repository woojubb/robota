/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';

const PORT_CHANNEL = 'desktop-session:port';
const REQUEST_CHANNEL = 'desktop-session:request';
const REQUEST_READY_CHANNEL = 'desktop-session:request-ready';
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_OUTSTANDING = 32;
let port: MessagePort | undefined;
let ended = false;
let receive: ((frame: string) => void) | undefined;
let notifyClose: (() => void) | undefined;
let notifyReady: (() => void) | undefined;
let incomingSeq = 0;
let outgoingSeq = 0;
const pending = new Set<number>();
const buffered: Array<{ seq: number; frame: string }> = [];
let readyScheduled = false;
let readyDelivered = false;

function fits(frame: string): boolean {
  return (
    frame.length <= MAX_FRAME_BYTES && new TextEncoder().encode(frame).byteLength <= MAX_FRAME_BYTES
  );
}

function close(): void {
  if (ended) return;
  ended = true;
  const current = port;
  port = undefined;
  current?.close();
  pending.clear();
  buffered.length = 0;
  const callback = notifyClose;
  receive = undefined;
  notifyClose = undefined;
  notifyReady = undefined;
  callback?.();
}

function deliver(seq: number, frame: string): void {
  if (!port || !receive || ended) return;
  try {
    receive(frame);
    if (!ended) port.postMessage({ kind: 'ack', seq });
  } catch {
    close();
  }
}

function signalReady(): void {
  if (readyScheduled || !port || !notifyReady || ended) return;
  readyScheduled = true;
  queueMicrotask(() => {
    if (ended || !port || !notifyReady) return;
    readyDelivered = true;
    try {
      notifyReady();
      for (const item of buffered.splice(0)) deliver(item.seq, item.frame);
    } catch {
      close();
    }
  });
}

if (process.isMainFrame) {
  ipcRenderer.on(REQUEST_READY_CHANNEL, () => { if (!ended) ipcRenderer.send(REQUEST_CHANNEL); });
  ipcRenderer.on(PORT_CHANNEL, (event) => {
    if (ended || port || event.ports.length !== 1) {
      for (const received of event.ports) received.close();
      close();
      return;
    }
    port = event.ports[0];
    port.onmessage = (message) => {
      if (ended || message.ports.length !== 0) {
        close();
        return;
      }
      const value: unknown = message.data;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('kind' in value) ||
        !('seq' in value) ||
        typeof value.seq !== 'number' ||
        !Number.isSafeInteger(value.seq)
      ) {
        close();
        return;
      }
      if (value.kind === 'ack') {
        if (!pending.delete(value.seq)) close();
        return;
      }
      if (
        value.kind !== 'frame' ||
        value.seq !== incomingSeq + 1 ||
        !('frame' in value) ||
        typeof value.frame !== 'string' ||
        !fits(value.frame)
      ) {
        close();
        return;
      }
      incomingSeq = value.seq;
      if (receive && readyDelivered && buffered.length === 0) deliver(value.seq, value.frame);
      else if (buffered.length < MAX_OUTSTANDING)
        buffered.push({ seq: value.seq, frame: value.frame });
      else close();
    };
    port.onmessageerror = close;
    port.addEventListener('close', close);
    port.start();
    signalReady();
  });

  contextBridge.exposeInMainWorld('desktopSession', {
    subscribe(onFrame: (frame: string) => void, onClose: () => void, onReady: () => void): () => void {
      if (
        ended ||
        receive ||
        typeof onFrame !== 'function' ||
        typeof onClose !== 'function' ||
        typeof onReady !== 'function'
      ) {
        throw new Error('Desktop session bridge is unavailable.');
      }
      receive = onFrame;
      notifyClose = onClose;
      notifyReady = onReady;
      signalReady();
      return close;
    },
    send(frame: string): boolean {
      if (
        ended ||
        !port ||
        typeof frame !== 'string' ||
        !fits(frame) ||
        pending.size >= MAX_OUTSTANDING
      )
        return false;
      const seq = ++outgoingSeq;
      pending.add(seq);
      try {
        port.postMessage({ kind: 'frame', seq, frame });
        return true;
      } catch {
        close();
        return false;
      }
    },
    close,
  });
  ipcRenderer.send(REQUEST_CHANNEL);
}
