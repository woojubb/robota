import type { ICommandHostContext, TRemoteControlStatus } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * `/remote-control` (REMOTE-008) — enable/stop P2P remote control and report status.
 *
 * The command is a declarative trigger: `enable` and `stop` return typed host effects
 * (`remote-control-enable-requested` / `-stop-requested`) that the host wires to the composition root
 * (commands never construct transports). `status` reads the injected
 * `ICommandHostAdapters.remoteControl.getStatus()` view — absent ⇒ the feature is unavailable in this host.
 */

function formatStatus(status: TRemoteControlStatus | undefined): ICommandResult {
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
        message: `Remote control is waiting for a device to pair.\nOpen: ${status.pairingUrl}`,
        success: true,
      };
    case 'paired':
      return { message: 'Remote control is active — a device is paired.', success: true };
    default:
      return { message: 'Remote control status is unknown.', success: true };
  }
}

export function executeRemoteControlCommand(
  context: ICommandHostContext,
  args: string,
): ICommandResult {
  const trimmed = args.trim();
  // Split into a lowercased verb + the original-case remainder (a deviceId is case-sensitive base64url).
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim();

  if (verb === 'status') {
    return formatStatus(context.getCommandHostAdapters?.().remoteControl?.getStatus());
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
      effects: [{ type: 'remote-control-stop-requested' as const }],
    };
  }

  // Default (empty / `enable` / `on`): request enable. The host reports the pairing QR/link.
  if (verb === '' || verb === 'enable' || verb === 'on') {
    return {
      message: 'Enabling remote control...',
      success: true,
      effects: [{ type: 'remote-control-enable-requested' as const }],
    };
  }

  return {
    message: `Unknown argument "${verb}". Usage: /remote-control [enable|stop|status|devices|revoke <id>]`,
    success: false,
  };
}
