import type { ICommandHostAdapterAccess, ICommandHostAdapters } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

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
  const status = peer.status === 'needs-input' ? 'needs input' : (peer.status ?? 'unknown');
  return `  ${peer.sessionId}${peer.name ? `  ${peer.name}` : ''}  status ${status}${self ? '' : workspace(peer)}${liveness}${self}`;
}

type TDeviceSummary = ReturnType<
  NonNullable<NonNullable<ICommandHostAdapters['localPeers']>['listDevices']>
>[number];

/** A linked device: its full id, since that is what `send` takes, and where it runs. */
function describeDevice(device: TDeviceSummary): string {
  const where = device.locality === 'same-host' ? 'on this machine' : 'on another machine';
  return `  ${device.deviceId}${device.name ? `  ${device.name}` : ''}  ${where}`;
}

/** The relation this session verified. A claim it could not confirm is named as such, not shown. */
function workspace(peer: TPeerSummary): string {
  if (peer.workspaceClaim === 'mismatched') return '  workspace claim mismatched, not believed';
  switch (peer.workspaceRelation) {
    case undefined:
      return '';
    case 'unknown':
      return '  workspace unknown';
    default:
      return `  ${peer.workspaceRelation.replace('-', ' ')}`;
  }
}

/**
 * PEER-006 — `/peers send <session-id> <text>`.
 *
 * Split on the FIRST run of whitespace only: everything after the session id is the message, spaces
 * and all. Splitting on every space would silently truncate any message with more than one word,
 * which is nearly all of them.
 */
function parseSend(args: string): { target: string; text: string } | undefined {
  const trimmed = args.trim();
  const at = trimmed.search(/\s/);
  if (at === -1) return undefined;
  const text = trimmed.slice(at).trim();
  if (text === '') return undefined;
  return { target: trimmed.slice(0, at), text };
}

/** A state the sender can act on, rendered as a sentence rather than a status word. */
function describeSend(result: { state: string; reason?: string }, target: string): ICommandResult {
  const reason = result.reason !== undefined ? ` ${result.reason}` : '';
  switch (result.state) {
    case 'acknowledged':
    case 'delivered':
      return { message: `Delivered to ${target}.`, success: true };
    case 'pending':
      // NOT reported as delivered. The peer has it and has not run it — usually because a turn is
      // already running there — and telling the operator it landed would hide a wait they can see.
      return {
        message: `${target} has the message; it is waiting behind work already running there.`,
        success: true,
      };
    case 'duplicate':
      return { message: `${target} had already seen that message.`, success: true };
    default:
      return { message: `Not delivered to ${target}.${reason}`, success: false };
  }
}

async function executeSend(
  adapter: NonNullable<ICommandHostAdapters['localPeers']>,
  args: string,
): Promise<ICommandResult> {
  if (adapter.send === undefined) {
    return {
      message: 'This environment can discover other sessions but cannot address them.',
      success: false,
    };
  }
  const parsed = parseSend(args);
  if (parsed === undefined) {
    return {
      message: 'Usage: /peers send <session-id> <message>. Run /peers for the session ids.',
      success: false,
    };
  }
  return describeSend(await adapter.send(parsed.target, parsed.text), parsed.target);
}

/**
 * `/peers send-file <session-id> <path>` — the operator sends a copy of a file.
 *
 * The operator typed the path, so any regular file they can read may go, including one outside the
 * workspace or one that looks like it holds secrets: this is the one way to send those. Everything
 * after the session id is the path, spaces and all.
 */
async function executeSendFile(
  adapter: NonNullable<ICommandHostAdapters['localPeers']>,
  args: string,
  cwd: string,
): Promise<ICommandResult> {
  if (adapter.prepareFile === undefined) {
    return { message: 'This environment cannot send files to other sessions.', success: false };
  }
  const parsed = parseSend(args);
  if (parsed === undefined) {
    return {
      message: 'Usage: /peers send-file <session-id> <path>. Run /peers for the session ids.',
      success: false,
    };
  }
  const prepared = await adapter.prepareFile(parsed.target, parsed.text, {
    origin: 'operator',
    cwd,
  });
  if (!prepared.ok) return { message: `Not sent: ${prepared.reason}`, success: false };
  const { file } = prepared;
  const result = await file.send();
  if (result.state === 'delivered' || result.state === 'acknowledged') {
    return {
      message: `Sent ${file.path} to ${parsed.target}: ${file.size} bytes, sha256 ${file.sha256}.`,
      success: true,
    };
  }
  const reason = result.reason !== undefined ? ` ${result.reason}` : '';
  return { message: `${file.path} was not sent to ${parsed.target}.${reason}`, success: false };
}

export async function executePeersCommand(
  context: ICommandHostAdapterAccess & { getCwd?(): string },
  args = '',
): Promise<ICommandResult> {
  const adapter = context.getCommandHostAdapters?.().localPeers;
  if (!adapter) {
    return { message: 'Local peer discovery is not available in this environment.', success: true };
  }

  // `send` must be a WHOLE word: `startsWith('send')` would also claim a session id beginning with
  // those four letters, and a uuid that happens to start `send…` is not a subcommand.
  const trimmed = args.trim();
  const sendFileVerb = /^send-file(?=\s|$)/.exec(trimmed);
  if (sendFileVerb !== null) {
    return executeSendFile(
      adapter,
      trimmed.slice(sendFileVerb[0].length),
      context.getCwd?.() ?? '',
    );
  }
  const sendVerb = /^send(?=\s|$)/.exec(trimmed);
  if (sendVerb !== null) return executeSend(adapter, trimmed.slice(sendVerb[0].length));

  const own = adapter.ownSessionId();
  // The workspace-judged listing when the host has one; it reads git, so only this view asks for it.
  const peers = (
    adapter.listWithWorkspace !== undefined ? await adapter.listWithWorkspace() : adapter.list()
  ).filter(addressable);
  const others = peers.filter((peer) => peer.sessionId !== own);
  const devices = adapter.listDevices?.() ?? [];

  if (others.length === 0 && devices.length === 0) {
    return {
      message:
        'No other live session is announced. Start a second session on this host, as this user, ' +
        'and it appears here.',
      success: true,
    };
  }

  const sections = [`Live sessions:\n${peers.map((peer) => describe(peer, own)).join('\n')}`];
  if (devices.length > 0) {
    sections.push(`Linked devices:\n${devices.map(describeDevice).join('\n')}`);
  }
  const target = devices.length > 0 ? '<session-or-device-id>' : '<session-id>';
  return {
    message:
      `${sections.join('\n\n')}\n\nSend to one: /peers send ${target} <message>` +
      `\nSend a file: /peers send-file ${target} <path>`,
    success: true,
  };
}
