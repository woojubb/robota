import { selectAction } from '@robota-sdk/agent-core';

import type {
  ICommandHostAdapterAccess,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandModule,
  ISystemCommand,
  ICommandOutputStyleRegistryAdapter,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

const OUTPUT_STYLE_DESCRIPTION = 'List or switch the active provider-neutral response style';
const OUTPUT_STYLE_ARGUMENT_HINT = 'list | <style-id>';

function getRegistry(
  context: ICommandHostAdapterAccess,
): ICommandOutputStyleRegistryAdapter | undefined {
  return context.getCommandHostAdapters?.().outputStyleRegistry;
}

function formatStyleList(active: string, registry: ICommandOutputStyleRegistryAdapter): string {
  const lines = registry.listOutputStyles().map((style) => {
    const marker = style.id === active ? '* ' : '  ';
    const cost = style.tokenCost ? ` [input cost: ${style.tokenCost}]` : '';
    return `${marker}${style.id} — ${style.name}: ${style.description}${cost}`;
  });
  return ['Available output styles:', ...lines].join('\n');
}

function listResult(
  context: ICommandHostSessionAccess,
  registry: ICommandOutputStyleRegistryAdapter,
): ICommandResult {
  const active = context.getActiveOutputStyleId();
  const outputStyles = registry.listOutputStyles();
  return {
    success: true,
    message: formatStyleList(active, registry),
    data: { outputStyles, active },
  };
}

async function chooseStyle(
  context: ICommandHostUserInteraction,
  registry: ICommandOutputStyleRegistryAdapter,
): Promise<string | undefined> {
  const interaction = context.getUserInteraction();
  if (!interaction) return undefined;
  const options = registry.listOutputStyles().map((style) => ({
    value: style.id,
    label: style.id,
    description: style.description,
  }));
  const response = await interaction.ask(
    selectAction('output-style', 'Select an output style', options),
  );
  return response.type === 'answer' ? response.values[0] : undefined;
}

export async function executeOutputStyleCommand(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess & ICommandHostUserInteraction,
  args: string,
): Promise<ICommandResult> {
  const registry = getRegistry(context);
  if (!registry) {
    return {
      success: false,
      message: 'Output styles are not available in this environment.',
    };
  }

  let styleId = args.trim();
  if (styleId === 'list') return listResult(context, registry);
  if (!styleId) {
    styleId = (await chooseStyle(context, registry)) ?? '';
    if (!styleId) return listResult(context, registry);
  }

  const style = registry.getOutputStyle(styleId);
  if (!style) {
    return {
      success: false,
      message: `Unknown output style "${styleId}". Available: ${
        registry
          .listOutputStyles()
          .map((entry) => entry.id)
          .join(', ') || '(none)'
      }`,
    };
  }

  return {
    success: true,
    message: `Switching output style to ${style.name}...`,
    data: { outputStyle: style.id },
    hostActions: [{ type: 'output-style-change', styleId: style.id }],
  };
}

export function createOutputStyleCommandEntry(): ICommand {
  return {
    name: 'output-style',
    displayName: 'Output Style',
    description: OUTPUT_STYLE_DESCRIPTION,
    argumentHint: OUTPUT_STYLE_ARGUMENT_HINT,
    source: 'output-style',
    userInvocable: true,
    modelInvocable: false,
  };
}

function createOutputStyleSystemCommand(): ISystemCommand {
  const entry = createOutputStyleCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    argumentHint: entry.argumentHint,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeOutputStyleCommand,
  };
}

export class OutputStyleCommandSource implements ICommandSource {
  readonly name = 'output-style';

  getCommands(): ICommand[] {
    return [createOutputStyleCommandEntry()];
  }
}

export function createOutputStyleCommandModule(): ICommandModule {
  return {
    name: 'agent-command-output-style',
    commandSources: [new OutputStyleCommandSource()],
    systemCommands: [createOutputStyleSystemCommand()],
  };
}
