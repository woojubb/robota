import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TClientMessage } from './wire-messages.js';
import type { ISettingsSnapshot, TSettingsPatch } from '@robota-sdk/agent-interface-session';

type TSettingsMessage = Extract<TClientMessage, { type: 'get-settings' | 'update-settings' }>;

export function isSettingsMessage(msg: TClientMessage): msg is TSettingsMessage {
  return msg.type === 'get-settings' || msg.type === 'update-settings';
}

/** What applying a patch did: the fresh snapshot, or why nothing was written. */
export type TSettingsUpdateOutcome =
  | { readonly ok: true; readonly settings: ISettingsSnapshot }
  | {
      readonly ok: false;
      readonly code: 'not_available' | 'invalid' | 'refused' | 'update_failed';
      readonly message: string;
    };

/**
 * #3282 §4a: host-owned read/write for the Settings screen, supplied by the composition root the
 * same way `IUsageQueryReporters` supplies usage reads — this package only correlates the request
 * and carries the result. `updateSettings` applies through the SAME function the matching slash
 * command uses (issue #3282 §4: "one code path, so the behavior matches the TUI"), so whatever a
 * command would refuse on this surface is refused here too.
 */
export interface ISettingsReporter {
  getSettings(session: IProtocolSession): ISettingsSnapshot | Promise<ISettingsSnapshot>;
  updateSettings(
    session: IProtocolSession,
    patch: TSettingsPatch,
  ): TSettingsUpdateOutcome | Promise<TSettingsUpdateOutcome>;
}

export function handleSettingsMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: TSettingsMessage,
  reporter: ISettingsReporter | undefined,
): void {
  if (!reporter) {
    deliverSettingsError(
      deliver,
      msg.requestId,
      'not_available',
      'Settings are not available on this host.',
    );
    return;
  }
  try {
    if (msg.type === 'get-settings') {
      void Promise.resolve(reporter.getSettings(session)).then(
        (settings) => deliver({ type: 'settings', requestId: msg.requestId, settings }),
        (error) =>
          deliverSettingsError(deliver, msg.requestId, 'update_failed', failureMessage(error)),
      );
      return;
    }
    void Promise.resolve(reporter.updateSettings(session, msg.patch)).then(
      (outcome) => {
        if (outcome.ok) {
          deliver({ type: 'settings', requestId: msg.requestId, settings: outcome.settings });
        } else {
          deliverSettingsError(deliver, msg.requestId, outcome.code, outcome.message);
        }
      },
      (error) =>
        deliverSettingsError(deliver, msg.requestId, 'update_failed', failureMessage(error)),
    );
  } catch (error) {
    deliverSettingsError(
      deliver,
      msg.requestId,
      'update_failed',
      failureMessage(error instanceof Error ? error : String(error)),
    );
  }
}

function deliverSettingsError(
  deliver: TOutboundDeliver,
  requestId: string,
  code: 'not_available' | 'invalid' | 'refused' | 'update_failed',
  message: string,
): void {
  deliver({ type: 'settings_error', requestId, code, message });
}

function failureMessage(error: Error | string): string {
  return error instanceof Error ? error.message : String(error);
}
