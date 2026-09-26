/**
 * Pure projections from session-protocol frames into what the TUI renders, for a terminal attached to
 * a session over the wire. Kept apart from the channel so each is testable without a connection.
 */

import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  ICommand,
  ICommandListEntry,
  ICommandSkillListEntry,
  ICommandSubcommandEntry,
} from '@robota-sdk/agent-interface-command';
import type { IWireHistoryEntry } from '@robota-sdk/agent-transport/client';

/**
 * The transcript names a prompt by the driver that sent it, and "You" for the operator. Over the wire
 * this terminal is a driver the host named, so its own prompts are shown as the operator's.
 */
export function displayDriverId(
  driverId: string | undefined,
  ownDriverId: string | undefined,
): string | undefined {
  return driverId !== undefined && driverId === ownDriverId ? OWNER_DRIVER_ID : driverId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Who this terminal is on the wire: the driver id the host gave it, and when it attached. The host
 * numbers the terminals attached to it from one each time it starts, and a prompt keeps its driver id
 * in the stored history, so an entry from before this terminal attached may carry the same id for
 * another terminal. Only what this terminal could have sent is shown as the user's.
 */
export interface IOwnDriver {
  readonly driverId: string;
  /** Milliseconds since the epoch. */
  readonly since: number;
}

/**
 * A chat entry's `data` is the message itself, whose own `timestamp` also crossed as a string. Any
 * ISO string is accepted: a resumed session sends strings for what was a `Date` in memory.
 */
function reviveChatMessage(data: unknown, ownDriverId: string | undefined): unknown {
  if (!isRecord(data)) return data;
  let revived = data;
  if (typeof data['timestamp'] === 'string') {
    revived = { ...revived, timestamp: new Date(data['timestamp']) };
  }
  const metadata = data['metadata'];
  if (ownDriverId !== undefined && isRecord(metadata) && metadata['driverId'] === ownDriverId) {
    revived = { ...revived, metadata: { ...metadata, driverId: OWNER_DRIVER_ID } };
  }
  return revived;
}

/**
 * The session's history as the TUI holds it: timestamps back to `Date`s. Only a chat entry's `data`
 * is a message; an event entry's is the event as recorded, and is left as it came.
 */
export function toHistoryEntries(
  entries: readonly IWireHistoryEntry[],
  own: IOwnDriver | undefined,
): IHistoryEntry[] {
  return entries.map((entry) => {
    const timestamp = new Date(entry.timestamp);
    if (entry.category !== 'chat' || entry.data === undefined) return { ...entry, timestamp };
    const ownDriverId =
      own !== undefined && timestamp.getTime() >= own.since ? own.driverId : undefined;
    return { ...entry, timestamp, data: reviveChatMessage(entry.data, ownDriverId) };
  });
}

/** A subcommand as the `/` menu offers it after its command's name. */
function toSubcommand(subcommand: ICommandSubcommandEntry): ICommand {
  return {
    name: subcommand.name,
    description: subcommand.description,
    source: 'builtin',
    ...(subcommand.displayName !== undefined ? { displayName: subcommand.displayName } : {}),
    ...(subcommand.argumentHint !== undefined ? { argumentHint: subcommand.argumentHint } : {}),
  };
}

/** What the `/` menu offers: the host's commands, then the skills a user may invoke. */
export function toCommandCatalog(
  commands: readonly ICommandListEntry[],
  skills: readonly ICommandSkillListEntry[],
): ICommand[] {
  return [
    ...commands.map((command): ICommand => ({
      name: command.name,
      description: command.description,
      source: 'builtin',
      modelInvocable: command.modelInvocable,
      ...(command.displayName !== undefined ? { displayName: command.displayName } : {}),
      ...(command.example !== undefined ? { example: command.example } : {}),
      ...(command.argumentHint !== undefined ? { argumentHint: command.argumentHint } : {}),
      ...(command.subcommands !== undefined && command.subcommands.length > 0
        ? { subcommands: command.subcommands.map(toSubcommand) }
        : {}),
    })),
    ...skills
      .filter((skill) => skill.userInvocable)
      .map((skill): ICommand => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        modelInvocable: skill.modelInvocable,
        userInvocable: skill.userInvocable,
        ...(skill.argumentHint !== undefined ? { argumentHint: skill.argumentHint } : {}),
        ...(skill.context !== undefined ? { context: skill.context } : {}),
        ...(skill.agent !== undefined ? { agent: skill.agent } : {}),
      })),
  ];
}

/** A command's subcommands, found by name as the in-process command registry finds them. */
export function findSubcommands(catalog: readonly ICommand[], commandName: string): ICommand[] {
  const lower = commandName.toLowerCase();
  const command = catalog.find(
    (entry) => entry.name.toLowerCase() === lower && entry.subcommands !== undefined,
  );
  return command?.subcommands ?? [];
}

/** The same prefix match the in-process command registry applies. */
export function filterCommandCatalog(catalog: readonly ICommand[], filter?: string): ICommand[] {
  if (!filter) return [...catalog];
  const lower = filter.toLowerCase();
  return catalog.filter((command) => command.name.toLowerCase().startsWith(lower));
}
