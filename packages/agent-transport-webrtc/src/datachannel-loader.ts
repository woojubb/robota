/**
 * The WebRTC implementation this transport runs on: `node-datachannel` (libdatachannel, with DTLS by
 * OpenSSL), an optional dependency loaded lazily.
 *
 * It is optional because it ships a native binary per platform. Where it cannot load — not installed,
 * or no prebuilt binary for this platform — the transport is unavailable and says so at the point of
 * use. There is deliberately no other implementation to fall back to: channel binding relies on this
 * DTLS stack verifying handshake signatures.
 */
import { createRequire } from 'node:module';

/** The slice of a `node-datachannel` data channel this transport drives. */
export interface INdcDataChannel {
  close(): void;
  sendMessage(message: string): boolean;
  isOpen(): boolean;
  bufferedAmount(): number;
  onOpen(callback: () => void): void;
  onClosed(callback: () => void): void;
  onError(callback: (error: string) => void): void;
  onMessage(callback: (message: string | Buffer | ArrayBuffer) => void): void;
}

/** An ICE server as `node-datachannel` takes it. */
export interface INdcIceServer {
  readonly hostname: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly relayType?: 'TurnUdp' | 'TurnTcp' | 'TurnTls';
}

export interface INdcConfig {
  iceServers: (string | INdcIceServer)[];
  iceTransportPolicy?: 'all' | 'relay';
  disableAutoNegotiation?: boolean;
}

/** The slice of a `node-datachannel` peer connection this transport drives. */
export interface INdcPeerConnection {
  close(): void;
  setLocalDescription(type?: 'offer' | 'answer'): void;
  setRemoteDescription(sdp: string, type: 'offer' | 'answer'): void;
  localDescription(): { type: string; sdp: string } | null;
  remoteFingerprint(): { value: string; algorithm: string };
  addRemoteCandidate(candidate: string, mid: string): void;
  createDataChannel(label: string): INdcDataChannel;
  state(): string;
  /** Diagnostics; not every build exposes them. */
  iceState?(): string;
  gatheringState?(): string;
  signalingState?(): string;
  onLocalDescription(callback: (sdp: string, type: string) => void): void;
  onLocalCandidate(callback: (candidate: string, mid: string) => void): void;
  onStateChange(callback: (state: string) => void): void;
  onDataChannel(callback: (channel: INdcDataChannel) => void): void;
}

/** The subset of the `node-datachannel` module surface this transport constructs. */
export interface IDataChannelModule {
  PeerConnection: new (name: string, config: INdcConfig) => INdcPeerConnection;
}

/** Resolve a module by id. The default resolves the real module; tests inject a throwing resolver. */
export type TModuleResolver = (id: string) => unknown;

const defaultResolver: TModuleResolver = (id) => {
  const requireFrom = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dependency; resolved at runtime, never bundled
  return requireFrom(id);
};

export function loadDataChannel(resolve: TModuleResolver = defaultResolver): IDataChannelModule {
  try {
    const module = resolve('node-datachannel') as Partial<IDataChannelModule> | undefined;
    if (typeof module?.PeerConnection !== 'function') throw new Error('no PeerConnection export');
    return module as IDataChannelModule;
  } catch {
    throw new Error(
      `WebRTC transport unavailable — the optional dependency "node-datachannel" is not installed or has no ` +
        `prebuilt binary for this platform (${process.platform}-${process.arch}).`,
    );
  }
}
