import type { ITool, IToolExecutionContext, IToolResult, TToolParameters, TUniversalValue } from '@robota-sdk/agents';
import { FunctionTool } from '@robota-sdk/agents';

import type { TScenarioMode } from './types.js';
import { ScenarioStore } from './store.js';
import { stringifyToolArguments } from './request-utils.js';

interface IScenarioToolWrapperOptions {
    mode: TScenarioMode;
    scenarioId?: string;
    store: ScenarioStore;
    tags?: string[];
    onToolCallUsed?: (toolCallId: string) => void;
}

function getToolSuccessDataOrThrow(result: IToolResult): TUniversalValue {
    if (!result.success) {
        throw new Error('[SCENARIO-TOOL] Internal error: expected success=true tool result');
    }
    if (result.data === undefined) {
        throw new Error('[SCENARIO-TOOL] Tool result is missing data (success=true but data is undefined)');
    }
    return result.data;
}

function getToolErrorMessageOrThrow(result: IToolResult): string {
    if (result.success) {
        throw new Error('[SCENARIO-TOOL] Internal error: expected success=false tool result');
    }
    const message = result.error;
    if (typeof message !== 'string' || message.length === 0) {
        throw new Error('[SCENARIO-TOOL] Tool result is missing error (success=false but error is empty)');
    }
    return message;
}

function formatToolSuccessContent(data: TUniversalValue): string {
    return typeof data === 'string' ? data : JSON.stringify(data);
}

function formatToolErrorContent(errorMessage: string): string {
    return `Error: ${errorMessage}`;
}

export function createScenarioToolWrapper(tool: ITool, options: IScenarioToolWrapperOptions): FunctionTool {
    const schema = tool.schema;

    return new FunctionTool(schema, async (params: TToolParameters, ctx?: IToolExecutionContext): Promise<TUniversalValue> => {
        if (options.mode === 'play') {
            if (!options.scenarioId) {
                throw new Error('[SCENARIO-TOOL] Missing scenarioId in play mode');
            }
            const toolCallId = ctx?.executionId;
            if (!toolCallId) {
                throw new Error('[SCENARIO-TOOL] Missing context.executionId (toolCallId) for tool playback');
            }

            const step = await options.store.findToolResultByToolCallIdForPlay(options.scenarioId, toolCallId);
            if (step.toolName !== schema.name) {
                throw new Error(
                    `[SCENARIO-TOOL-MISMATCH] Recorded toolName "${step.toolName}" does not match runtime tool "${schema.name}" ` +
                    `for toolCallId="${toolCallId}".`
                );
            }
            const runtimeToolArguments = stringifyToolArguments(params);
            if (step.toolArguments !== runtimeToolArguments) {
                throw new Error(
                    `[SCENARIO-TOOL-MISMATCH] Recorded toolArguments do not match runtime arguments for toolCallId="${toolCallId}".`
                );
            }
            options.onToolCallUsed?.(toolCallId);

            if (step.success) {
                if (step.resultData === undefined) {
                    throw new Error(`[SCENARIO-TOOL] tool_result step is missing resultData for toolCallId="${toolCallId}"`);
                }
                return step.resultData;
            }

            const errorMessage = step.errorMessage;
            if (typeof errorMessage !== 'string' || errorMessage.length === 0) {
                throw new Error(`[SCENARIO-TOOL] tool_result step is missing errorMessage for toolCallId="${toolCallId}"`);
            }
            throw new Error(errorMessage);
        }

        // Record / none mode: execute the real tool.
        const result = await tool.execute(params, ctx);

        if (options.mode === 'record') {
            if (!options.scenarioId) {
                throw new Error('[SCENARIO-TOOL] Missing scenarioId in record mode');
            }
            const toolCallId = ctx?.executionId;
            if (!toolCallId) {
                throw new Error('[SCENARIO-TOOL] Missing context.executionId (toolCallId) for tool recording');
            }

            const toolArguments = stringifyToolArguments(params);
            const toolMessageContent = result.success
                ? formatToolSuccessContent(getToolSuccessDataOrThrow(result))
                : formatToolErrorContent(getToolErrorMessageOrThrow(result));

            await options.store.appendToolResultStep({
                scenarioId: options.scenarioId,
                toolCallId,
                toolName: schema.name,
                toolArguments,
                toolMessageContent,
                ...(result.success ? { resultData: getToolSuccessDataOrThrow(result) } : undefined),
                success: result.success,
                ...(result.success ? undefined : { errorMessage: getToolErrorMessageOrThrow(result) }),
                tags: options.tags
            });

            if (!result.success) {
                throw new Error(getToolErrorMessageOrThrow(result));
            }
        }

        if (!result.success) {
            throw new Error(getToolErrorMessageOrThrow(result));
        }
        return getToolSuccessDataOrThrow(result);
    });
}


