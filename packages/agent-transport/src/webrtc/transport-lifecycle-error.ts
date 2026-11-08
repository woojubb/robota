import type { ITransportLifecycleError } from '@robota-sdk/agent-interface-transport';

export function createTransportLifecycleError(
  code: ITransportLifecycleError['code'],
): ITransportLifecycleError {
  return Object.assign(new Error(`WebRtcTransport ${code}.`), {
    name: 'TransportLifecycleError' as const,
    code,
    transportName: 'webrtc',
  });
}
