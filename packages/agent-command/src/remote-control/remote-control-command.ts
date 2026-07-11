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
  const sub = args.trim().toLowerCase();

  if (sub === 'status') {
    return formatStatus(context.getCommandHostAdapters?.().remoteControl?.getStatus());
  }

  if (sub === 'stop' || sub === 'off') {
    return {
      message: 'Stopping remote control...',
      success: true,
      effects: [{ type: 'remote-control-stop-requested' as const }],
    };
  }

  // Default (empty / `enable` / `on`): request enable. The host reports the pairing QR/link.
  if (sub === '' || sub === 'enable' || sub === 'on') {
    return {
      message: 'Enabling remote control...',
      success: true,
      effects: [{ type: 'remote-control-enable-requested' as const }],
    };
  }

  return {
    message: `Unknown argument "${sub}". Usage: /remote-control [enable|stop|status]`,
    success: false,
  };
}
