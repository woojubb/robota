import {
  AbstractNodeDefinition,
  BINARY_PORT_PRESETS,
  NodeIoAccessor,
  createBinaryPortDefinition,
} from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TResult,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import { z } from 'zod';
import { TextToImageRuntime, type ITextToImageRuntimeOptions } from './runtime-core.js';

export type { ITextToImageRequest, ITextToImageRuntimeOptions } from './runtime-core.js';
export { TextToImageRuntime } from './runtime-core.js';

/** Options for constructing a {@link TextToImageNodeDefinition}. */
export interface ITextToImageNodeDefinitionOptions extends ITextToImageRuntimeOptions {}

const DEFAULT_TEXT_TO_IMAGE_COST_USD = 0.02;

export const TextToImageConfigSchema = z.object({
  model: z.string().default(''),
  baseCredits: z.number().default(DEFAULT_TEXT_TO_IMAGE_COST_USD),
});

export type TTextToImageConfig = z.output<typeof TextToImageConfigSchema>;

/**
 * DAG node that generates a new image from a text prompt using the Gemini image API.
 *
 * Takes only a text prompt (no input image) and returns the generated image.
 *
 * @extends AbstractNodeDefinition
 */
export class TextToImageNodeDefinition extends AbstractNodeDefinition<
  typeof TextToImageConfigSchema
> {
  public readonly nodeType = 'text-to-image';
  public readonly displayName = 'Text to Image';
  public readonly category = 'AI';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    createBinaryPortDefinition({
      key: 'image',
      label: 'Image',
      order: 0,
      required: true,
      preset: BINARY_PORT_PRESETS.IMAGE_COMMON,
    }),
  ];
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'image';
  public readonly configSchemaDefinition = TextToImageConfigSchema;

  private readonly runtime: TextToImageRuntime;

  public constructor(options?: ITextToImageNodeDefinitionOptions) {
    super();
    this.runtime = new TextToImageRuntime(options);
  }

  public override async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    config: TTextToImageConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: config.baseCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TTextToImageConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textInputResult = io.requireInputString('text');
    if (!textInputResult.ok || textInputResult.value.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_TEXT_TO_IMAGE_PROMPT_REQUIRED',
          'Text-to-image node requires non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    const generateResult = await this.runtime.generateImage({
      prompt: textInputResult.value.trim(),
      model: config.model,
    });
    if (!generateResult.ok) {
      return generateResult;
    }
    if (generateResult.value.kind !== 'image') {
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_TEXT_TO_IMAGE_OUTPUT_INVALID',
          'Text-to-image node returned non-image output',
          false,
        ),
      };
    }
    io.setOutput('image', generateResult.value);
    io.setOutput(
      '_agentSummary',
      `Image generated from prompt with Gemini. Model: ${config.model}.`,
    );
    return { ok: true, value: io.toOutput() };
  }
}

export function createTextToImageNodeDefinition(): TextToImageNodeDefinition {
  return new TextToImageNodeDefinition();
}
