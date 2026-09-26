/**
 * A scripted stand-in for the `node-datachannel` module: records the configuration a connection is
 * built with and exposes the callbacks the transport registers, so a test can drive them.
 */
import type {
  IDataChannelModule,
  INdcConfig,
  INdcDataChannel,
  INdcPeerConnection,
} from '../datachannel-loader.js';

export interface IFakeChannelOptions {
  readonly sendMessage?: (message: string) => boolean;
  readonly close?: () => void;
}

export interface IFakeConnection {
  readonly config: INdcConfig;
  readonly setRemoteDescription: (sdp: string, type: string) => void;
  /** Callbacks the transport registered. */
  localCandidate?: (candidate: string, mid: string) => void;
  channelClosed?: () => void;
  channelMessage?: (message: string) => void;
}

export interface IFakeDataChannel {
  readonly module: IDataChannelModule;
  readonly connections: IFakeConnection[];
}

export function fakeDataChannel(
  options: {
    readonly offerSdp?: string;
    readonly channel?: IFakeChannelOptions;
    readonly setRemoteDescription?: (sdp: string, type: string) => void;
  } = {},
): IFakeDataChannel {
  const connections: IFakeConnection[] = [];
  const offerSdp = options.offerSdp ?? 'a=fingerprint:sha-256 AA';
  const PeerConnection = function (_name: string, config: INdcConfig): INdcPeerConnection {
    const record: IFakeConnection = {
      config,
      setRemoteDescription: options.setRemoteDescription ?? (() => undefined),
    };
    connections.push(record);
    let onLocalDescription: ((sdp: string, type: string) => void) | undefined;
    const channel: INdcDataChannel = {
      close: options.channel?.close ?? (() => undefined),
      sendMessage: options.channel?.sendMessage ?? (() => true),
      isOpen: () => true,
      bufferedAmount: () => 0,
      onOpen: () => undefined,
      onClosed: (callback) => {
        record.channelClosed = callback;
      },
      onError: () => undefined,
      onMessage: (callback) => {
        record.channelMessage = callback;
      },
    };
    return {
      close: () => undefined,
      setLocalDescription: (type) => {
        queueMicrotask(() => onLocalDescription?.(offerSdp, type ?? 'offer'));
      },
      setRemoteDescription: (sdp, type) => record.setRemoteDescription(sdp, type),
      localDescription: () => ({ type: 'offer', sdp: offerSdp }),
      remoteFingerprint: () => ({ value: '', algorithm: 'sha-256' }),
      addRemoteCandidate: () => undefined,
      createDataChannel: () => channel,
      state: () => 'new',
      onLocalDescription: (callback) => {
        onLocalDescription = callback;
      },
      onLocalCandidate: (callback) => {
        record.localCandidate = callback;
      },
      onStateChange: () => undefined,
      onDataChannel: () => undefined,
    };
  } as unknown as IDataChannelModule['PeerConnection'];
  return { module: { PeerConnection }, connections };
}
