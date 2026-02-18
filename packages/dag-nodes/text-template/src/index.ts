import {
    NodeIoAccessor,
    buildValidationError,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ESCAPED_PERCENT_S_TOKEN = '__ROBOTA_TEXT_TEMPLATE_ESCAPED_PERCENT_S__';

class TextTemplateNodeTaskHandler {
    public async validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const textInputResult = io.requireInput('text');
        if (!textInputResult.ok) {
            return textInputResult;
        }
        if (typeof textInputResult.value !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_TEXT_TEMPLATE_INPUT_TYPE_MISMATCH',
                    'text-template node input "text" must be a string.',
                    { nodeId: context.nodeDefinition.nodeId, inputKey: 'text' }
                )
            };
        }
        return { ok: true, value: undefined };
    }

    public async estimateCost(): Promise<TResult<ICostEstimate, IDagError>> {
        return {
            ok: true,
            value: { estimatedCostUsd: 0 }
        };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const textInputResult = io.requireInput('text');
        if (!textInputResult.ok) {
            return textInputResult;
        }
        if (typeof textInputResult.value !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_TEXT_TEMPLATE_INPUT_TYPE_MISMATCH',
                    'text-template node input "text" must be a string.',
                    { nodeId: context.nodeDefinition.nodeId, inputKey: 'text' }
                )
            };
        }

        const templateConfigValue = context.nodeDefinition.config.template;
        if (typeof templateConfigValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_TEXT_TEMPLATE_CONFIG_TEMPLATE_REQUIRED',
                    'text-template node config.template must be a string.',
                    { nodeId: context.nodeDefinition.nodeId, configKey: 'template' }
                )
            };
        }

        const escapedTemplate = templateConfigValue.split('%%s').join(ESCAPED_PERCENT_S_TOKEN);
        const replacedTemplate = escapedTemplate.split('%s').join(textInputResult.value);
        const outputText = replacedTemplate.split(ESCAPED_PERCENT_S_TOKEN).join('%s');
        io.setOutput('text', outputText);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export class TextTemplateNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'text-template';
    public readonly displayName = 'Text Template';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = z.object({
        template: z
            .string()
            .default('%s')
            .describe('Template string. %s is replaced with input text. Use %%s for a literal %s.')
    });
    public readonly taskHandler = new TextTemplateNodeTaskHandler();
}
