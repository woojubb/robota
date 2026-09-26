import type {
  ICommandHostAdapterAccess,
  ICommandHostWorkspace,
  TRemoteControlStatus,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

/**
 * `/remote-control` (REMOTE-008) — enable/stop P2P remote control and report status.
 *
 * The command is a declarative trigger: `enable` and `stop` return typed HOST ACTIONS
 * (`remote-control-enable` / `remote-control-stop`) executed by the session via the composition-root
 * adapter (commands never construct transports). `status` reads the injected
 * `ICommandHostAdapters.remoteControl.getStatus()` view — absent ⇒ the feature is unavailable in this host.
 *
 * Pairing and trust belong to the operator at this terminal. A surface that is already connected
 * may stop remote control and read its state, but it cannot mint a pairing link, read the one on
 * offer, or revoke a trusted device: otherwise one connected surface could admit the next.
 */

const OPERATOR_ONLY =
  'only the operator at this terminal can do this; a connected surface cannot pair, enroll or revoke devices. ' +
  'Run `/remote-control` on the host terminal.';

function formatStatus(
  status: TRemoteControlStatus | undefined,
  showPairingLink: boolean,
): ICommandResult {
  if (!status) {
    return { message: 'Remote control is not available in this environment.', success: true };
  }
  switch (status.state) {
    case 'off':
      return {
        message: 'Remote control is off. Use `/remote-control` to enable it.',
        success: true,
      };
    case 'no-relay':
      return {
        message:
          'Remote control is unavailable: no signaling relay is configured ' +
          '(set `transports.webrtc.options.relayUrl`).',
        success: true,
      };
    case 'awaiting-pairing':
      return {
        message: showPairingLink
          ? `Remote control is waiting for a device to pair.\nOpen: ${status.pairingUrl}`
          : 'Remote control is waiting for a device to pair. The pairing link is shown only on the host terminal.',
        success: true,
      };
    case 'paired':
      return { message: 'Remote control is active — a device is paired.', success: true };
    default:
      return { message: 'Remote control status is unknown.', success: true };
  }
}

export function executeRemoteControlCommand(
  context: ICommandHostAdapterAccess & Pick<ICommandHostWorkspace, 'getCommandInvocationSource'>,
  args: string,
): ICommandResult {
  const operator = context.getCommandInvocationSource() === 'user';
  const trimmed = args.trim();
  // Split into a lowercased verb + the original-case remainder (a deviceId is case-sensitive base64url).
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb === 'status') {
    const adapter = context.getCommandHostAdapters?.().remoteControl;
    const result = formatStatus(adapter?.getStatus(), operator);
    if (!adapter?.describeKeyStorage) return result;
    const storage = adapter.describeKeyStorage() ?? 'chosen when remote control is first enabled';
    return { ...result, message: `${result.message}\nHost key storage: ${storage}` };
  }

  if (verb === 'devices') {
    const adapter = context.getCommandHostAdapters?.().remoteControl;
    const devices = adapter?.listDevices?.();
    if (!devices) {
      return {
        message: 'Trusted-device reconnect is not available in this environment.',
        success: true,
      };
    }
    if (devices.length === 0) {
      return { message: 'No trusted devices are enrolled yet.', success: true };
    }
    const lines = devices.map((d) => `  ${d.deviceId}  ${d.label}  (last seen ${d.lastSeenAt})`);
    return { message: `Trusted devices:\n${lines.join('\n')}`, success: true };
  }

  if (verb === 'revoke') {
    if (!operator) {
      return { message: `\`/remote-control revoke\`: ${OPERATOR_ONLY}`, success: false };
    }
    if (!rest) {
      return { message: 'Usage: /remote-control revoke <deviceId>', success: false };
    }
    const adapter = context.getCommandHostAdapters?.().remoteControl;
    if (!adapter?.revokeDevice) {
      return {
        message: 'Trusted-device reconnect is not available in this environment.',
        success: true,
      };
    }
    const removed = adapter.revokeDevice(rest);
    return removed
      ? { message: `Revoked trusted device ${rest}. It must re-pair to reconnect.`, success: true }
      : { message: `No trusted device with id ${rest}.`, success: false };
  }

  if (verb === 'stop' || verb === 'off') {
    return {
      message: 'Stopping remote control...',
      success: true,
      hostActions: [{ type: 'remote-control-stop' as const }],
    };
  }

  // Default (empty / `enable` / `on`): request enable. The host reports the pairing QR/link.
  if (verb === '' || verb === 'enable' || verb === 'on') {
    if (!operator) {
      return { message: `\`/remote-control enable\`: ${OPERATOR_ONLY}`, success: false };
    }
    return {
      message: 'Enabling remote control...',
      success: true,
      hostActions: [{ type: 'remote-control-enable' as const }],
    };
  }

  return {
    message: `Unknown argument "${verb}". Usage: /remote-control [enable|stop|status|devices|revoke <id>]`,
    success: false,
  };
}
