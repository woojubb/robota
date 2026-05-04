import type {
  ICommandHostContext,
  ICommandResult,
  IModelCommandModuleOptions,
} from '@robota-sdk/agent-sdk';
import { formatModelCommandUsageMessage } from '@robota-sdk/agent-sdk';

function parseModelId(args: string): string | undefined {
  const modelId = args.trim().split(/\s+/)[0];
  return modelId !== undefined && modelId.length > 0 ? modelId : undefined;
}

export function executeModelCommand(
  _context: ICommandHostContext,
  args: string,
  options?: IModelCommandModuleOptions,
): ICommandResult {
  const modelId = parseModelId(args);
  if (modelId === undefined) {
    return {
      message: formatModelCommandUsageMessage({
        settings: options?.settings.readMergedSettings(),
        providerDefinitions: options?.providerDefinitions,
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
