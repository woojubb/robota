import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ESCAPED_PERCENT_S_TOKEN = '__ROBOTA_TEXT_TEMPLATE_ESCAPED_PERCENT_S__';

const TextTemplateConfigSchema = z.object({
    template: z
        .string()
        .default('%s')
        .describe('Template string. %s is replaced with input text. Use %%s for a literal %s.')
});

/**
 * DAG node that applies a template string to input text.
 *
 * The configured template uses `%s` as the placeholder for the input text value.
 * Use `%%s` to produce a literal `%s` in the output.
 *
 * @extends AbstractNodeDefinition
 */
export class TextTemplateNodeDefinition extends AbstractNodeDefinition<typeof TextTemplateConfigSchema> {
    public readonly nodeType = 'text-template';
    public readonly displayName = 'Text Template';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = TextTemplateConfigSchema;

    protected override async validateInputWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        _config: z.output<typeof TextTemplateConfigSchema>
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
            value: { estimatedCredits: 0 }
        };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof TextTemplateConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const textInputResult = io.requireInputString('text');
        if (!textInputResult.ok) {
            return textInputResult;
        }

        const escapedTemplate = config.template.split('%%s').join(ESCAPED_PERCENT_S_TOKEN);
        const replacedTemplate = escapedTemplate.split('%s').join(textInputResult.value);
        const outputText = replacedTemplate.split(ESCAPED_PERCENT_S_TOKEN).join('%s');
        io.setOutput('text', outputText);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}
