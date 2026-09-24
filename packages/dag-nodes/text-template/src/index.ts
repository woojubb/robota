import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  resolveDagExecutionByteLimits,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';
import { renderTemplateWithinByteLimit } from './render-template.js';

const TextTemplateConfigSchema = z.object({
  template: z
    .string()
    .default('%s')
    .describe(
      'Template string. Supports two syntaxes: {{text}} (Handlebars-style) or %s (printf-style). Both replace input text. Use %%s for a literal %s.',
    ),
});

/**
 * DAG node that applies a template string to input text.
 *
 * The configured template uses `%s` as the placeholder for the input text value.
 * Use `%%s` to produce a literal `%s` in the output.
 *
 * @extends AbstractNodeDefinition
 */
export class TextTemplateNodeDefinition extends AbstractNodeDefinition<
  typeof TextTemplateConfigSchema
> {
  public readonly nodeType = 'text-template';
  public readonly displayName = 'Text Template';
  public readonly category = 'Core';
  public override readonly defaultInputPort = 'text';
  public override readonly defaultOutputPort = 'text';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  public readonly configSchemaDefinition = TextTemplateConfigSchema;

  protected override async validateInputWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    _config: z.output<typeof TextTemplateConfigSchema>,
  ): Promise<TResult<void, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textInputResult = io.requireInputString('text');
    if (!textInputResult.ok) {
      return textInputResult;
    }
    return { ok: true, value: undefined };
  }

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return {
      ok: true,
      value: { estimatedCredits: 0 },
    };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof TextTemplateConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const textInputResult = io.requireInputString('text');
    if (!textInputResult.ok) {
      return textInputResult;
    }

    const rendered = renderTemplateWithinByteLimit(
      config.template, textInputResult.value,
      resolveDagExecutionByteLimits(context.byteLimits).maxTextTemplateOutputBytes,
    );
    if (!rendered.ok) return rendered;
    const outputText = rendered.value;
    io.setOutput('text', outputText);
    io.setOutput('_agentSummary', `Template rendered. Output length: ${outputText.length} chars.`);
    return {
      ok: true,
      value: io.toOutput(),
    };
  }
}
