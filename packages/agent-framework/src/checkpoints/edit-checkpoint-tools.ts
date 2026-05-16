import type {
  IEventService,
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { IEditCheckpointRecorder } from './edit-checkpoint-types.js';

const CHECKPOINTED_TOOL_NAMES = new Set(['Write', 'Edit']);

export function wrapEditCheckpointTools(
  tools: readonly IToolWithEventService[],
  recorder: IEditCheckpointRecorder,
): IToolWithEventService[] {
  return tools.map((tool) =>
    CHECKPOINTED_TOOL_NAMES.has(tool.getName())
      ? new EditCheckpointToolWrapper(tool, recorder)
      : tool,
  );
}

class EditCheckpointToolWrapper implements IToolWithEventService {
  readonly schema: IToolSchema;

  constructor(
    private readonly delegate: IToolWithEventService,
    private readonly recorder: IEditCheckpointRecorder,
  ) {
    this.schema = delegate.schema;
  }

  setEventService(eventService: IEventService | undefined): void {
    this.delegate.setEventService(eventService);
  }

  async execute(parameters: TToolParameters, context: IToolExecutionContext): Promise<IToolResult> {
    const filePath = extractFilePath(parameters);
    if (filePath) {
      await this.recorder.captureFile(filePath);
    }
    return this.delegate.execute(parameters, context);
  }

  validate(parameters: TToolParameters): boolean {
    return this.delegate.validate(parameters);
  }

  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    return this.delegate.validateParameters(parameters);
  }

  getDescription(): string {
    return this.delegate.getDescription();
  }

  getName(): string {
    return this.delegate.getName();
  }
}

function extractFilePath(parameters: TToolParameters): string | undefined {
  if (!parameters || typeof parameters !== 'object') return undefined;
  const value = parameters.filePath;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
