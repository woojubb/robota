import { bindTransportAdapter } from '@robota-sdk/agent-framework';
import type { TransportRegistry } from '@robota-sdk/agent-framework';
import type { IRemoteControlTransportHost } from './remote-control-controller.js';

/** Bind the exact protocol session at the CLI host boundary. */
export function createRemoteControlTransportHost(
  registry: Pick<TransportRegistry, 'register' | 'replace'>,
): IRemoteControlTransportHost {
  let admitted = false;
  return {
    registerInitial: (peer, session) => {
      const bound = bindTransportAdapter(peer, session);
      if (admitted) registry.replace(bound);
      else {
        registry.register(bound);
        admitted = true;
      }
    },
    promoteWinner: (peer, session) => registry.replace(bindTransportAdapter(peer, session)),
  };
}
