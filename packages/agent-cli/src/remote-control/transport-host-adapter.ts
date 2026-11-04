import { bindTransportAdapter } from '@robota-sdk/agent-framework';

import { SECURE_SURFACES, startListener } from '../secure/secure-surfaces.js';

import type { TransportRegistry } from '@robota-sdk/agent-framework';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type {
  IRemoteControlTransportHost,
  TRemoteControlPeer,
} from './remote-control-controller.js';

/**
 * Bind the exact protocol session at the CLI host boundary. The registry restarts every enabled
 * transport itself (a TUI session switch stops and starts them all), so the peer it holds opens under
 * the remote-control row too, not only the starts the controller makes.
 */
export function createRemoteControlTransportHost(
  registry: Pick<TransportRegistry, 'register' | 'replace'>,
  productRuntime: ICliRuntimeContext,
): IRemoteControlTransportHost {
  let admitted = false;
  const bind = (peer: TRemoteControlPeer, session: IProtocolSession) => {
    const adapter = bindTransportAdapter(peer, session);
    return {
      ...adapter,
      start: () =>
        startListener(SECURE_SURFACES['remote-control'], productRuntime, () => adapter.start()),
    };
  };
  return {
    registerInitial: (peer, session) => {
      const bound = bind(peer, session);
      if (admitted) registry.replace(bound);
      else {
        registry.register(bound);
        admitted = true;
      }
    },
    promoteWinner: (peer, session) => registry.replace(bind(peer, session)),
  };
}
