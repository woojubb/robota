import { bindTransportAdapter } from '@robota-sdk/agent-framework';
import type { TransportRegistry } from '@robota-sdk/agent-framework';
import type { IRemoteControlTransportHost } from './remote-control-controller.js';

/** Bind the exact protocol session at the CLI host boundary. */
export function createRemoteControlTransportHost(
  registry: Pick<TransportRegistry, 'register' | 'replace'>,
): IRemoteControlTransportHost {
  return {
    registerInitial: (peer, session) => registry.register(bindTransportAdapter(peer, session)),
    promoteWinner: (peer, session) => registry.replace(bindTransportAdapter(peer, session)),
  };
}
