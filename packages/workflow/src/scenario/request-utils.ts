import crypto from 'crypto';
import type { IChatOptions, TToolParameters, TUniversalMessage, TUniversalValue } from '@robota-sdk/agents';
import { isAssistantMessage, isToolMessage, isUserMessage } from '@robota-sdk/agents';
import type { IScenarioChatOptionsSnapshot, IScenarioMessageSnapshot, IScenarioRequestSnapshot } from './types.js';

export function serializeMessages(messages: TUniversalMessage[]): IScenarioMessageSnapshot[] {
    return messages.map(message => serializeMessage(message));
}

export function serializeChatOptions(options?: IChatOptions): IScenarioChatOptionsSnapshot | undefined {
    if (!options) return undefined;
    const extendedOptions = options as IChatOptions & {
        topP?: number;
        presencePenalty?: number;
        frequencyPenalty?: number;
    };
    const snapshot: IScenarioChatOptionsSnapshot = {};
    if (options.model) snapshot.model = options.model;
    if (typeof options.temperature === 'number') snapshot.temperature = options.temperature;
    if (typeof options.maxTokens === 'number') snapshot.maxTokens = options.maxTokens;
    if (typeof extendedOptions.topP === 'number') snapshot.topP = extendedOptions.topP;
    if (typeof extendedOptions.presencePenalty === 'number') {
        snapshot.presencePenalty = extendedOptions.presencePenalty;
    }
    if (typeof extendedOptions.frequencyPenalty === 'number') {
        snapshot.frequencyPenalty = extendedOptions.frequencyPenalty;
    }
    if (typeof options.openai?.stream === 'boolean') {
        snapshot.stream = options.openai.stream;
    }
    if (Array.isArray(options.tools)) {
        snapshot.tools = options.tools.map(tool => ({ name: (tool as { name?: string }).name }));
    }
    return snapshot;
}

export function createRequestHash(messages: TUniversalMessage[], options?: IChatOptions): string {
    const payload = stableStringify({
        messages: serializeMessagesForHash(messages),
        options: serializeOptionsForHash(options)
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}

export function createRequestHashFromSnapshot(request: IScenarioRequestSnapshot): string {
    const payload = stableStringify({
        messages: request.messages.map(m => ({
            role: m.role,
            content: m.role === 'assistant' ? (typeof m.content === 'string' ? m.content : '') : (m.content ?? null),
            ...(m.role === 'user' && m.name ? { name: m.name } : undefined),
            ...(m.role === 'tool' ? { toolCallId: m.toolCallId } : undefined),
            ...(m.role === 'assistant' && Array.isArray(m.toolCalls)
                ? { toolCalls: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) }
                : undefined)
        })),
        options: request.options ? serializeOptionsForHash(request.options) : undefined
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}

export function stringifyToolArguments(parameters: TToolParameters): string {
    // SSOT: tool arguments are stored as stable JSON string.
    return stableStringify(parameters);
}

function serializeMessage(message: TUniversalMessage): IScenarioMessageSnapshot {
    const base: IScenarioMessageSnapshot = {
        role: message.role,
        content: message.role === 'assistant' ? (typeof message.content === 'string' ? message.content : '') : (message.content ?? null),
        metadata: message.metadata ? structuredClone(message.metadata) : undefined,
        timestamp: message.timestamp.getTime()
    };

    if (isUserMessage(message) && message.name) {
        base.name = message.name;
    }
    if (isToolMessage(message)) {
        base.toolCallId = message.toolCallId;
        base.name = message.name;
    }
    if (isAssistantMessage(message) && message.toolCalls) {
        base.toolCalls = message.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments
        }));
    }

    return base;
}

function serializeMessagesForHash(messages: TUniversalMessage[]): TUniversalValue {
    return messages.map(message => ({
        role: message.role,
        content: message.role === 'assistant' ? (typeof message.content === 'string' ? message.content : '') : (message.content ?? null),
        ...(isUserMessage(message) && message.name ? { name: message.name } : undefined),
        ...(isToolMessage(message) ? { toolCallId: message.toolCallId } : undefined),
        ...(isAssistantMessage(message) && message.toolCalls
            ? {
                toolCalls: message.toolCalls.map(tc => ({
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments
                }))
            }
            : undefined)
    }));
}

function serializeOptionsForHash(options?: IChatOptions | IScenarioChatOptionsSnapshot): TUniversalValue | undefined {
    if (!options) return undefined;
    const snapshot: Record<string, TUniversalValue> = {};
    const opt = options as Partial<IScenarioChatOptionsSnapshot> & Partial<IChatOptions>;

    if (typeof opt.model === 'string') snapshot.model = opt.model;
    if (typeof opt.temperature === 'number') snapshot.temperature = opt.temperature;
    if (typeof opt.maxTokens === 'number') snapshot.maxTokens = opt.maxTokens;
    if (typeof opt.topP === 'number') snapshot.topP = opt.topP;
    if (typeof opt.presencePenalty === 'number') snapshot.presencePenalty = opt.presencePenalty;
    if (typeof opt.frequencyPenalty === 'number') snapshot.frequencyPenalty = opt.frequencyPenalty;
    if (typeof opt.stream === 'boolean') snapshot.stream = opt.stream;

    const openaiStream = opt.openai?.stream;
    if (typeof openaiStream === 'boolean') snapshot.stream = openaiStream;

    const tools = opt.tools;
    if (Array.isArray(tools)) snapshot.tools = tools.map(t => ({ name: t.name }));

    return snapshot;
}

function stableStringify(value: TUniversalValue | undefined): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
    const entries = Object.entries(value as Record<string, TUniversalValue>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
