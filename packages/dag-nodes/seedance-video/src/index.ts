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
import { SeedanceVideoRuntime, type ISeedanceVideoRuntimeOptions } from './runtime-core.js';

export type { ISeedanceVideoRequest, ISeedanceVideoRuntimeOptions } from './runtime-core.js';
export { SeedanceVideoRuntime } from './runtime-core.js';

/** Options for constructing a {@link SeedanceVideoNodeDefinition}. */
export interface ISeedanceVideoNodeDefinitionOptions extends ISeedanceVideoRuntimeOptions {}

const DEFAULT_SEEDANCE_VIDEO_COST_USD = 0.5;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_WAIT_MS = 300000;

export const SeedanceVideoConfigSchema = z.object({
  model: z.string().default(''),
  baseCredits: z.number().default(DEFAULT_SEEDANCE_VIDEO_COST_USD),
  durationSeconds: z.number().int().positive().optional(),
  aspectRatio: z.string().optional(),
  pollIntervalMs: z.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
  maxWaitMs: z.number().int().positive().default(DEFAULT_MAX_WAIT_MS),
});

export type TSeedanceVideoConfig = z.output<typeof SeedanceVideoConfigSchema>;

/**
 * DAG node that generates a video from a text prompt using the ByteDance/Seedance video API.
 *
 * Submits an async job and polls until it completes, then returns the generated video.
 *
 * @extends AbstractNodeDefinition
 */
export class SeedanceVideoNodeDefinition extends AbstractNodeDefinition<
  typeof SeedanceVideoConfigSchema
> {
  public readonly nodeType = 'seedance-video';
  public readonly displayName = 'Seedance Video';
  public readonly category = 'AI';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    createBinaryPortDefinition({
      key: 'video',
      label: 'Video',
      order: 0,
      required: true,
      preset: BINARY_PORT_PRESETS.VIDEO_MP4,
    }),
  ];
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'video';
  public readonly configSchemaDefinition = SeedanceVideoConfigSchema;

  private readonly runtime: SeedanceVideoRuntime;

  public constructor(options?: ISeedanceVideoNodeDefinitionOptions) {
    super();
    this.runtime = new SeedanceVideoRuntime(options);
  }

  public override async estimateCostWithConfig(
    _input: TPortPayload,
    _context: INodeExecutionContext,
    config: TSeedanceVideoConfig,
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: config.baseCredits } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: TSeedanceVideoConfig,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textInputResult = io.requireInputString('text');
    if (!textInputResult.ok || textInputResult.value.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SEEDANCE_VIDEO_PROMPT_REQUIRED',
          'Seedance video node requires non-empty text input',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    const generateResult = await this.runtime.generateVideo({
      prompt: textInputResult.value.trim(),
      model: config.model,
      ...(config.durationSeconds !== undefined ? { durationSeconds: config.durationSeconds } : {}),
      ...(config.aspectRatio !== undefined ? { aspectRatio: config.aspectRatio } : {}),
      pollIntervalMs: config.pollIntervalMs,
      maxWaitMs: config.maxWaitMs,
    });
    if (!generateResult.ok) {
      return generateResult;
    }
    if (generateResult.value.kind !== 'video') {
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_INVALID',
          'Seedance video node returned non-video output',
          false,
        ),
      };
    }
    io.setOutput('video', generateResult.value);
    io.setOutput(
      '_agentSummary',
      `Video generated from prompt with Seedance. Model: ${config.model}.`,
    );
    return { ok: true, value: io.toOutput() };
  }
}

export function createSeedanceVideoNodeDefinition(): SeedanceVideoNodeDefinition {
  return new SeedanceVideoNodeDefinition();
}
