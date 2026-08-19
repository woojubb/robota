import type { ICommandHostAdapterAccess, ICommandHostAdapters } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/** One row as the port hands it over. Derived, so it cannot drift from the adapter it reads. */
type TPeerSummary = ReturnType<NonNullable<ICommandHostAdapters['localPeers']>['list']>[number];

/**
 * `/peers` (PEER-004, #1863) — which other live sessions this one can address.
 *
 * Discovery landed as a leaf (a guarded rendezvous directory, an entry per live session, liveness
 * settled by pid AND process start time) and nothing called it: measured on this tree, no file
 * outside the module and its tests referenced `announcePeer` or `openLocalPeerRendezvous`. This
 * command is the surface that makes it observable, which is also what makes it falsifiable — a
 * discovery layer nobody can look at is one nobody can catch being wrong.
 *
 * The command reads an injected adapter and touches no filesystem, for the same reason it never
 * constructs a transport: the guarded directory, its permissions and the liveness rule are
 * composition-root concerns and must have one owner.
 */

/** `dead` is not shown. An entry whose process is gone is debris, not a peer. */
function addressable(peer: TPeerSummary): boolean {
  return peer.liveness !== 'dead';
}

function describe(peer: TPeerSummary, ownSessionId: string): string {
  const self = peer.sessionId === ownSessionId ? '  (this session)' : '';
  // `unknown` is printed, never rounded to `alive`. A host that cannot read process start times
  // answers `unknown` for every peer, and a reader who is not told that would take a stale entry for
  // a live session.
  const liveness = peer.liveness === 'unknown' ? '  liveness unknown' : '';
  return `  ${peer.sessionId}${peer.name ? `  ${peer.name}` : ''}${liveness}${self}`;
}

export function executePeersCommand(context: ICommandHostAdapterAccess): ICommandResult {
  const adapter = context.getCommandHostAdapters?.().localPeers;
  if (!adapter) {
    return { message: 'Local peer discovery is not available in this environment.', success: true };
  }

  const own = adapter.ownSessionId();
  const peers = adapter.list().filter(addressable);
  const others = peers.filter((peer) => peer.sessionId !== own);

  if (others.length === 0) {
    return {
      message:
        'No other live session is announced. Start a second session on this host, as this user, ' +
        'and it appears here.',
      success: true,
    };
  }

  const lines = peers.map((peer) => describe(peer, own));
  return { message: `Live sessions:\n${lines.join('\n')}`, success: true };
}
