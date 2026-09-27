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
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

const ACTION_SWITCH = 'switch';
const ACTION_EDIT = 'edit';
const ACTION_TEST = 'test';
const ACTION_DUPLICATE = 'duplicate';
const ACTION_DELETE = 'delete';

/**
 * Ask the user to pick a provider profile, then drive its action menu (CMD-004 inline ask). Replaces
 * the former returned choice→submit continuation chain — the picker's own option list is the rendered
 * profile list, so the caller no longer prepends a separate list message.
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
  // #3282 §2: no separate 'cancel' option here — the picker's own persistent Cancel affordance
  // (every ask renderer offers one, e.g. `PermissionPrompt`'s ghost Cancel button in agent-ui-web)
  // is the only Cancel a person sees. A second one, indistinguishable from Switch/Edit/Test/Duplicate
  // in a flat list, was the audited bug (#3282 issue text): "Delete looks the same as Switch... plus
  // a second Cancel." Order matters too — Switch first as the primary action, then Edit/Test/
  // Duplicate, with Delete last: a client (the GUI's provider-action menu) that wants Delete
  // separated and styled destructive can rely on it always being the final entry.
  const response = await ui.ask(
    selectAction('provider-profile-action', `Provider profile: ${profileName}`, [
      { value: ACTION_SWITCH, label: 'Switch' },
      { value: ACTION_EDIT, label: 'Edit' },
      { value: ACTION_TEST, label: 'Test' },
      { value: ACTION_DUPLICATE, label: 'Duplicate' },
      { value: ACTION_DELETE, label: 'Delete' },
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
    default:
      return { message: `Unknown provider profile action "${action}".`, success: false };
  }
}
