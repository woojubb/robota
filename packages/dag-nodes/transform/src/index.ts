import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  resolveDagExecutionByteLimits,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TResult,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const TransformNodeConfigSchema = z.object({
  prefix: z.string().default(''),
});

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Measure a virtual concatenation without allocating the output string. */
function prefixedUtf8Bytes(prefix: string, text: string): number {
  let bytes = 0;
  for (const part of [prefix, text]) {
    for (let index = 0; index < part.length; index++) {
      const code = part.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (isHighSurrogate(code) && isLowSurrogate(part.charCodeAt(index + 1))) {
        bytes += 4;
        index++;
      } else bytes += 3;
    }
  }
  if (isHighSurrogate(prefix.charCodeAt(prefix.length - 1)) && isLowSurrogate(text.charCodeAt(0))) {
    bytes -= 2;
  }
  return bytes;
}

/**
 * DAG node that transforms input data by optionally prepending a configured prefix to text.
 *
 * When the `text` input is present, the configured `prefix` is prepended. Otherwise,
 * all input entries are passed through to the output unchanged.
 *
 * @extends AbstractNodeDefinition
 */
export class TransformNodeDefinition extends AbstractNodeDefinition<
  typeof TransformNodeConfigSchema
> {
  public readonly nodeType = 'transform';
  public readonly displayName = 'Transform';
  public readonly category = 'Core';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
    { key: 'data', label: 'Data', order: 1, type: 'object', required: false },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
    { key: 'data', label: 'Data', order: 1, type: 'object', required: false },
  ];
  public readonly configSchemaDefinition = TransformNodeConfigSchema;

  protected override async validateInputWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: z.output<typeof TransformNodeConfigSchema>,
  ): Promise<TResult<void, IDagError>> {
    if (Object.keys(input).length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_TRANSFORM_INPUT_REQUIRED',
          'Transform node requires at least one input value',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }
    return { ok: true, value: undefined };
  }

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0.0001 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TransformNodeConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textValue = io.getInput('text');
    if (typeof textValue === 'string') {
      const maxBytes = resolveDagExecutionByteLimits(context.byteLimits).maxTextTransformOutputBytes;
      if (prefixedUtf8Bytes(config.prefix, textValue) > maxBytes) {
        return { ok: false, error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
          'transform output exceeds its UTF-8 byte limit', false,
          { maxBytes, nodeType: 'transform' },
        ) };
      }
      const transformed = `${config.prefix}${textValue}`;
      io.setOutput('text', transformed);
      io.setOutput(
        '_agentSummary',
        `Transformed input. Output length: ${transformed.length} chars.`,
      );
    } else {
      for (const [key, value] of Object.entries(input)) {
        io.setOutput(key, value);
      }
      io.setOutput('_agentSummary', `Passed through ${Object.keys(input).length} port(s).`);
    }
    return { ok: true, value: io.toOutput() };
  }
}
