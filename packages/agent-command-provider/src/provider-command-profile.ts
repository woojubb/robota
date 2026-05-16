import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-sdk';
import { testProviderProfileCommand } from '@robota-sdk/agent-sdk';
import {
  buildProviderEdit,
  buildProviderSwitch,
  formatProviderChoiceLabel,
} from './provider-command-profile-operations.js';
import {
  buildProviderDelete,
  buildProviderDuplicate,
} from './provider-command-profile-lifecycle.js';

const ACTION_SWITCH = 'switch';
const ACTION_EDIT = 'edit';
const ACTION_TEST = 'test';
const ACTION_DUPLICATE = 'duplicate';
const ACTION_DELETE = 'delete';
const ACTION_CANCEL = 'cancel';

export function createProviderProfileSelectionInteraction(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: 'Select provider profile',
      options: Object.entries(providers ?? {}).map(([name, profile]) => ({
        value: name,
        label: formatProviderChoiceLabel(name, profile, currentProvider),
      })),
      maxVisible: 8,
    },
    submit: (value) => buildProviderProfileActionMenu(value, options),
    cancel: () => ({ message: 'Provider profile selection cancelled.', success: true }),
  };
}

function buildProviderProfileActionMenu(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  if (!settings.providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  return {
    message: `Provider profile selected: ${profileName}`,
    success: true,
    interaction: createProviderProfileActionInteraction(profileName, options),
  };
}

function createProviderProfileActionInteraction(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: `Provider profile: ${profileName}`,
      options: [
        { value: ACTION_SWITCH, label: 'Switch' },
        { value: ACTION_EDIT, label: 'Edit' },
        { value: ACTION_TEST, label: 'Test' },
        { value: ACTION_DUPLICATE, label: 'Duplicate' },
        { value: ACTION_DELETE, label: 'Delete' },
        { value: ACTION_CANCEL, label: 'Cancel' },
      ],
    },
    submit: (value) => executeProviderProfileAction(profileName, value, options),
    cancel: () => ({ message: 'Provider profile action cancelled.', success: true }),
  };
}

async function executeProviderProfileAction(
  profileName: string,
  action: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  switch (action) {
    case ACTION_SWITCH:
      return buildProviderSwitch(settings.providers, profileName, options);
    case ACTION_EDIT:
      return buildProviderEdit(profileName, options);
    case ACTION_TEST:
      return await testProviderProfileCommand(
        settings.currentProvider,
        settings.providers,
        profileName,
        options,
      );
    case ACTION_DUPLICATE:
      return buildProviderDuplicate(profileName, options);
    case ACTION_DELETE:
      return buildProviderDelete(profileName, options);
    case ACTION_CANCEL:
      return { message: 'Provider profile action cancelled.', success: true };
    default:
      return { message: `Unknown provider profile action "${action}".`, success: false };
  }
}
