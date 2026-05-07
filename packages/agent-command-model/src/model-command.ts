import type {
  ICommandHostContext,
  ICommandResult,
  IModelCommandModuleOptions,
} from '@robota-sdk/agent-sdk';
import { formatModelCommandUsageMessageAsync } from '@robota-sdk/agent-sdk';

function parseModelId(args: string): string | undefined {
  const modelId = args.trim().split(/\s+/)[0];
  return modelId !== undefined && modelId.length > 0 ? modelId : undefined;
}

export async function executeModelCommand(
  _context: ICommandHostContext,
  args: string,
  options?: IModelCommandModuleOptions,
): Promise<ICommandResult> {
  const modelId = parseModelId(args);
  if (modelId === undefined) {
    return {
      message: await formatModelCommandUsageMessageAsync({
        ...(options?.settings !== undefined
          ? { settings: options.settings.readMergedSettings() }
          : {}),
        ...(options?.providerDefinitions !== undefined
          ? { providerDefinitions: options.providerDefinitions }
          : {}),
        refresh: true,
      }),
      success: false,
    };
  }

  return {
    message: `Model change requested: ${modelId}`,
    success: true,
    data: { modelId },
    effects: [{ type: 'model-change-requested', modelId }],
  };
}
