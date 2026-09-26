/**
 * `/devices` — this device's place in the user's device identity: list the roster, create the
 * identity, enrol another device or join with one, revoke a device, recover from the recovery phrase.
 *
 * Operator-only, twice over: the command is not model-invocable, and it refuses any invocation that
 * is not the operator's own (a remote surface, the model). Every verb that touches a secret or
 * asks for a confirmation runs inside the terminal handoff, so what is typed goes to the host's
 * terminal and never through the session's input, prompt history or conversation — the enrollment
 * code included, which is why `join` reads it there instead of taking it as an argument. Without an
 * interactive terminal those verbs refuse rather than fall back to anything else.
 */
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type {
  IDevicesCommandPort,
  IDevicesView,
  TDevicesOutcome,
  TDevicesRefusal,
} from './devices-command-port.js';
import type {
  ICommandHostContext,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

const SHORT_ID_CHARS = 10;
const USAGE = 'Usage: /devices [list|init [name]|add|join [name]|revoke <device-id>|recover]';

export function createDevicesCommandEntry(): ICommand {
  return {
    name: 'devices',
    displayName: 'Devices',
    description:
      "Manage this device's identity among the user's devices: list the roster, create the identity and its recovery phrase, enrol another device (add shows a one-time code; join on the new device reads it), revoke a device, or rotate the signing key from the phrase. Operator-only; the phrase and the enrollment code are handled on the terminal only, and results carry only device ids and names.",
    source: 'devices',
    modelInvocable: false,
    userInvocable: true,
    argumentHint: '[list|init [name]|add|join [name]|revoke <device-id>|recover]',
    subcommands: [
      { name: 'list', description: 'List your devices', source: 'devices' },
      {
        name: 'init',
        description: 'Create your device identity and recovery phrase',
        source: 'devices',
        argumentHint: '[name]',
      },
      {
        name: 'revoke',
        description: 'Revoke a device with the signing key',
        source: 'devices',
        argumentHint: '<device-id>',
      },
      {
        name: 'recover',
        description: 'Rotate the signing key from your recovery phrase',
        source: 'devices',
      },
      {
        name: 'add',
        description: 'Enrol another device: show a one-time code for it',
        source: 'devices',
      },
      {
        name: 'join',
        description: 'Join your devices with the code another device shows',
        source: 'devices',
        argumentHint: '[name]',
      },
    ],
  };
}

const REFUSALS: Readonly<Record<TDevicesRefusal, string>> = {
  'no-terminal':
    'This needs an interactive terminal; the recovery phrase is never shown or read anywhere else.',
  'not-initialized': 'This device has no identity yet. Run `/devices init` first.',
  'already-initialized':
    'This device already has an identity. Use `/devices recover` to rotate its signing key.',
  cancelled: 'Cancelled. Nothing was changed.',
  'confirmation-failed': 'The confirmation did not match. Nothing was changed.',
  'phrase-invalid': 'That is not a valid recovery phrase. Nothing was changed.',
  'phrase-mismatch':
    'That phrase (with that passphrase) belongs to a different identity than this device. Nothing was changed.',
  'no-signing-key':
    'This device does not hold the signing key. Revoke from a device that does, or `/devices recover`.',
  'signing-key-expired':
    'The signing key on this device has expired. Run `/devices recover` to issue a new one.',
  'unknown-device': 'No device in the roster has that id.',
  'ambiguous-device': 'More than one device starts with that id; give more of it.',
  'self-revocation':
    'This device cannot revoke itself. Revoke it from another device, or `/devices recover`.',
  'changed-concurrently':
    'The device identity changed in another session while this was waiting. Nothing was changed; try again.',
  'no-relay':
    'Enrolling a device needs a signaling relay. Set `transports.webrtc.options.relayUrl` in your settings on both devices.',
  'code-invalid': 'That is not an enrollment code. Nothing was changed.',
  'code-on-command-line':
    'Do not put the code on the command line, where history keeps it. Run `/devices add` again on the other device for a new code, then `/devices join` here and type it at the prompt.',
  'code-not-accepted':
    'No device accepted that code: it is wrong, expired or already used, or the connection was tampered with. Run `/devices add` on the other device for a new code.',
  'enrollment-expired': 'The code expired before a device joined. Nothing was changed.',
  'too-many-attempts':
    'Too many attempts failed to prove the code, so it no longer works. Nothing was changed; run `/devices add` again.',
  'enrollment-declined': 'The enrollment was declined. Nothing was changed.',
  'enrollment-timed-out': 'Nobody answered in time. Nothing was changed.',
  'enrollment-failed':
    'The signaling relay or the connection to the other device failed before the enrollment finished. Nothing was changed; try again.',
};

function short(id: string): string {
  return id.slice(0, SHORT_ID_CHARS);
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function refused(reason: TDevicesRefusal): ICommandResult {
  return { success: false, message: REFUSALS[reason] };
}

function formatList(view: IDevicesView | undefined): ICommandResult {
  if (view === undefined) return { success: true, message: REFUSALS['not-initialized'] };
  const lines = view.devices.map((device) => {
    const notes = [
      ...(device.thisDevice ? ['this device'] : []),
      ...(device.holdsSigningKey ? ['holds the signing key'] : []),
    ];
    const suffix = notes.length > 0 ? `  (${notes.join(', ')})` : '';
    return `  ${short(device.deviceId)}  ${device.name}${suffix}  certificate expires ${day(device.certificateExpiresAt)}`;
  });
  return {
    success: true,
    message: [
      `Devices of user ${short(view.userId)}:`,
      ...lines,
      `${view.revokedDeviceCount} revoked. Roster and revocation list valid until ${new Date(view.listsExpireAt).toISOString()}.`,
    ].join('\n'),
  };
}

function isOperator(context: ICommandHostContext): boolean {
  return context.getCommandInvocationSource() === 'user';
}

/** Run a terminal-bound port call; a refusal or a thrown error becomes a failed result. */
async function onTerminal<T>(
  context: ICommandHostContext,
  run: () => Promise<TDevicesOutcome<T>>,
  done: (value: T) => string,
): Promise<ICommandResult> {
  if (!context.canHandoffTerminal()) return refused('no-terminal');
  try {
    const outcome = await context.runWithTerminal(run);
    return outcome.ok ? { success: true, message: done(outcome.value) } : refused(outcome.reason);
  } catch (error) {
    return {
      success: false,
      message: `Device identity operation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

export async function executeDevicesCommand(
  port: IDevicesCommandPort,
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  if (!isOperator(context)) {
    return {
      success: false,
      message:
        '`/devices` runs only for the operator at this terminal, never from a remote surface or the model.',
    };
  }
  const trimmed = args.trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  // Device ids are case-sensitive base64url, so the remainder keeps its case.
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  switch (verb) {
    case '':
    case 'list':
      try {
        return formatList(await port.list());
      } catch (error) {
        return {
          success: false,
          message: `Device identity could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
        };
      }
    case 'init':
      return onTerminal(
        context,
        () => port.init(rest.length > 0 ? { name: rest } : {}),
        (value) =>
          [
            `Device identity created. This device: ${short(value.deviceId)}; user ${short(value.userId)}.`,
            `It holds signing key ${short(value.signingKeyId)}.`,
            ...(value.keyStorage !== undefined
              ? [`Private keys are kept in: ${value.keyStorage}.`]
              : []),
            'Keep the recovery phrase offline; it is the only way to recover this identity.',
          ].join('\n'),
      );
    case 'recover':
      return onTerminal(
        context,
        () => port.recover(),
        (value) =>
          [
            `Recovered. New signing key ${short(value.signingKeyId)}; ${value.revokedSigningKeyCount} old signing key(s) revoked.`,
            `This device (${short(value.deviceId)}) is certified again.`,
            ...(value.droppedDeviceCount > 0
              ? [
                  `${value.droppedDeviceCount} other device(s) were certified by a retired signing key and must enrol again.`,
                ]
              : []),
          ].join('\n'),
      );
    case 'revoke':
      if (rest.length === 0)
        return { success: false, message: 'Usage: /devices revoke <device-id>' };
      return onTerminal(
        context,
        () => port.revoke(rest),
        (value) =>
          `Revoked ${value.name} (${short(value.deviceId)}). A new roster and revocation list were issued.`,
      );
    case 'add':
      return onTerminal(
        context,
        () => port.add(),
        (value) =>
          [
            `Enrolled ${value.name} (${short(value.deviceId)}). A new roster was issued.`,
            ...(value.confirmed
              ? []
              : ['The new device did not confirm it kept its identity; check `/devices` there.']),
          ].join('\n'),
      );
    case 'join':
      return onTerminal(
        context,
        () => port.join(rest.length > 0 ? { name: rest } : {}),
        (value) =>
          [
            `Joined the devices of user ${short(value.userId)}. This device: ${value.name} (${short(value.deviceId)}).`,
            ...(value.keyStorage !== undefined
              ? [`Private keys are kept in: ${value.keyStorage}.`]
              : []),
          ].join('\n'),
      );
    default:
      return { success: false, message: `Unknown argument "${verb}". ${USAGE}` };
  }
}

export class DevicesCommandSource implements ICommandSource {
  readonly name = 'devices';

  getCommands(): ICommand[] {
    return [createDevicesCommandEntry()];
  }
}

export function createDevicesCommandModule(port: IDevicesCommandPort): ICommandModule {
  const command: ISystemCommand = createSystemCommandFromEntry(createDevicesCommandEntry(), {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: (context, args) => executeDevicesCommand(port, context, args),
  });
  return {
    name: 'agent-command-devices',
    commandSources: [new DevicesCommandSource()],
    systemCommands: [command],
  };
}
