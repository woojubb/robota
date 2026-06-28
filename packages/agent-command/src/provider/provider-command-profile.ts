import { selectAction } from '@robota-sdk/agent-core';
import { testProviderProfileCommand } from '@robota-sdk/agent-framework';

import {
  buildProviderDelete,
  buildProviderDuplicate,
} from './provider-command-profile-lifecycle.js';
import {
  buildProviderEdit,
  buildProviderSwitch,
  formatProviderChoiceLabel,
} from './provider-command-profile-operations.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

const ACTION_SWITCH = 'switch';
const ACTION_EDIT = 'edit';
const ACTION_TEST = 'test';
const ACTION_DUPLICATE = 'duplicate';
const ACTION_DELETE = 'delete';
const ACTION_CANCEL = 'cancel';

/**
 * Ask the user to pick a provider profile, then drive its action menu (CMD-004 inline ask). Replaces
 * the legacy `ICommandInteraction` choice→submit continuation chain — the picker's own option list is
 * the rendered profile list, so the caller no longer prepends a separate list message.
 */
export async function askProviderProfileSelection(
  ui: IUserInteraction,
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const profileOptions = Object.entries(providers ?? {}).map(([name, profile]) => ({
    value: name,
    label: formatProviderChoiceLabel(name, profile, currentProvider),
  }));
  const response = await ui.ask(
    selectAction('provider-profile', 'Select provider profile', profileOptions, { maxVisible: 8 }),
  );
  if (response.type !== 'answer' || response.values[0] === undefined) {
    return { message: 'Provider profile selection cancelled.', success: true };
  }
  return askProviderProfileAction(ui, response.values[0], options);
}

async function askProviderProfileAction(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  if (!settings.providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const response = await ui.ask(
    selectAction('provider-profile-action', `Provider profile: ${profileName}`, [
      { value: ACTION_SWITCH, label: 'Switch' },
      { value: ACTION_EDIT, label: 'Edit' },
      { value: ACTION_TEST, label: 'Test' },
      { value: ACTION_DUPLICATE, label: 'Duplicate' },
      { value: ACTION_DELETE, label: 'Delete' },
      { value: ACTION_CANCEL, label: 'Cancel' },
    ]),
  );
  if (response.type !== 'answer' || response.values[0] === undefined) {
    return { message: 'Provider profile action cancelled.', success: true };
  }
  return executeProviderProfileAction(ui, profileName, response.values[0], options);
}

async function executeProviderProfileAction(
  ui: IUserInteraction,
  profileName: string,
  action: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  switch (action) {
    case ACTION_SWITCH:
      return buildProviderSwitch(settings.providers, profileName, options);
    case ACTION_EDIT:
      return buildProviderEdit(ui, profileName, options);
    case ACTION_TEST:
      return testProviderProfileCommand(
        settings.currentProvider,
        settings.providers,
        profileName,
        options,
      );
    case ACTION_DUPLICATE:
      return buildProviderDuplicate(ui, profileName, options);
    case ACTION_DELETE:
      return buildProviderDelete(ui, profileName, options);
    case ACTION_CANCEL:
      return { message: 'Provider profile action cancelled.', success: true };
    default:
      return { message: `Unknown provider profile action "${action}".`, success: false };
  }
}
