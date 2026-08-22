import type {
  ICommandHostAdapterAccess,
  ICommandHostAdapters,
  ICommandHostUserInteraction,
  IHandoffProgress,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * `/handoff` (HANDOFF-001, issue #1864) — move this session to another machine.
 *
 * The command holds no protocol. It reads an injected adapter and touches no transport, for the same
 * reason `/peers` does not: the carrier, the wire composition and the device identity are
 * composition-root concerns and must have one owner.
 *
 * ## What it is FOR, which is the consent
 *
 * A hand-off loses things on purpose — uncommitted working-tree changes and running subprocesses
 * stay on this machine, because moving them would make this a file-sync product and a process cannot
 * migrate at all. Those are the operator's to lose, so they are named in the prompt BEFORE the
 * question, not reported afterwards. A confirmation that did not mention them is not consent.
 *
 * ## The sentence it always ends on
 *
 * Every outcome that is not `done` says the session is still on this machine. That is not
 * reassurance: it is the one invariant the whole design exists to preserve, and the operator is the
 * person who has to know whether to keep typing here or walk to the other computer.
 */

type THandoffHost = ICommandHostAdapterAccess & Partial<ICommandHostUserInteraction>;

/** The line that answers "where is my session?" — printed on every path, success included. */
function whereIsIt(progress: IHandoffProgress): string {
  return progress.stillMine
    ? 'This session is still on this machine, and still yours to use.'
    : 'This session now belongs to the destination. This copy is read-only.';
}

function describeDestinations(
  destinations: readonly { readonly deviceId: string; readonly name?: string }[],
): string {
  return destinations.map((d) => `  ${d.deviceId}${d.name ? `  ${d.name}` : ''}`).join('\n');
}

function usage(): ICommandResult {
  return {
    success: true,
    message: [
      'Usage:',
      '  /handoff              list the machines this session could move to',
      '  /handoff <device-id>  move it there, after confirming what stays behind',
    ].join('\n'),
  };
}

export async function executeHandoffCommand(
  context: THandoffHost,
  args: string,
): Promise<ICommandResult> {
  const adapter: ICommandHostAdapters['handoff'] = context.getCommandHostAdapters?.().handoff;
  if (adapter === undefined) {
    // Said plainly rather than offered and then failed. A host with no carrier cannot move a
    // session, and a command that took the request anyway would spend the operator's attention
    // before telling them.
    return {
      success: false,
      message:
        'This session has no hand-off carrier, so it cannot be moved to another machine. ' +
        'Nothing changed — the session is still here.',
    };
  }

  const target = args.trim();
  if (target === '' || target === 'help') {
    const destinations = await adapter.destinations();
    if (destinations.length === 0) {
      return {
        success: true,
        message:
          'No other machine is reachable for a hand-off right now.\n' + whereIsIt(adapter.status()),
      };
    }
    return {
      success: true,
      message: [
        'This session could move to:',
        describeDestinations(destinations),
        '',
        usage().message ?? '',
      ].join('\n'),
    };
  }

  const destinations = await adapter.destinations();
  if (!destinations.some((d) => d.deviceId === target)) {
    return {
      success: false,
      message:
        `No reachable machine is called '${target}'.\n` +
        (destinations.length > 0
          ? `Reachable now:\n${describeDestinations(destinations)}`
          : 'None are reachable right now.') +
        `\n${whereIsIt(adapter.status())}`,
    };
  }

  const staying = await adapter.staysBehind();
  const consequences = [
    staying.uncommittedChanges
      ? '  - uncommitted changes in the working tree stay on THIS machine'
      : null,
    staying.subprocesses > 0
      ? `  - ${staying.subprocesses} running process(es) stay on THIS machine and will not be reachable there`
      : null,
    '  - the destination uses ITS OWN provider credential; credentials are never transferred',
  ].filter((line): line is string => line !== null);

  const ask = context.getUserInteraction?.();
  if (ask === undefined) {
    // No human is attached. Refused, never guessed: a hand-off is irreversible from the source's
    // side, and "nobody was there to say no" is not a yes.
    return {
      success: false,
      message:
        'A hand-off needs a person to confirm what stays behind, and no interactive session is ' +
        `attached.\n${whereIsIt(adapter.status())}`,
    };
  }

  const answer = await ask.ask({
    id: `handoff:${target}`,
    title: `Move this session to ${target}?`,
    description: ['What will NOT travel:', ...consequences].join('\n'),
    options: [
      { value: 'move', label: `Move it to ${target}` },
      { value: 'stay', label: 'Keep it here' },
    ],
  });
  if (answer.type !== 'answer' || !answer.values.includes('move')) {
    return {
      success: true,
      message: `Hand-off cancelled.\n${whereIsIt(adapter.status())}`,
    };
  }

  const progressLines: string[] = [];
  const final = await adapter.transfer(target, (progress) => {
    progressLines.push(renderProgress(progress, target));
  });

  return {
    success: final.state === 'done',
    message: [
      ...progressLines,
      final.state === 'done'
        ? `Hand-off complete. ${target} is running this session now.`
        : `Hand-off stopped: ${final.reason ?? 'no reason was reported'}.`,
      whereIsIt(final),
    ].join('\n'),
  };
}

/**
 * One progress line, in the operator's vocabulary.
 *
 * `awaiting-confirmation` is spelled out rather than shortened because it is the phase the operator
 * is most likely to interrupt: the payload is on the other machine and this one has not yet heard
 * that it is on disk there. Quitting here is safe, and the wording is what says so.
 */
function renderProgress(progress: IHandoffProgress, target: string): string {
  // Exhaustive by construction: the default returns nothing rather than a plausible-looking line, so
  // a new state added to the contract shows up as a blank line in a test instead of as a wrong one.
  switch (progress.state) {
    case 'offered':
      return `Offering the session to ${target}...`;
    case 'sending':
      return 'Sending the session...';
    case 'awaiting-confirmation':
      return `Sent. Waiting for ${target} to confirm it has the session on disk — until it does, this machine keeps it.`;
    case 'done':
      return `${target} confirmed it has the session.`;
    case 'stopped':
      return `Stopped: ${progress.reason ?? 'no reason was reported'}.`;
    default:
      return '';
  }
}
