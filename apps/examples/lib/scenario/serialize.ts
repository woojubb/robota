import type { IRawProviderResponse, TUniversalMessage } from '@robota-sdk/agents';
import { isAssistantMessage, isToolMessage, isUserMessage } from '@robota-sdk/agents';

import type { IScenarioMessageSnapshot, IScenarioResponseSnapshot } from './types';

export function deserializeMessage(snapshot: IScenarioMessageSnapshot): TUniversalMessage {
    const timestamp = new Date(snapshot.timestamp);
    const metadata = snapshot.metadata ? structuredClone(snapshot.metadata) : undefined;

    switch (snapshot.role) {
        case 'user': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid user message content (expected string)');
            }
            return {
                role: 'user',
                content: snapshot.content,
                ...(snapshot.name && { name: snapshot.name }),
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'system': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid system message content (expected string)');
            }
            return {
                role: 'system',
                content: snapshot.content,
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'tool': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid tool message content (expected string)');
            }
            if (!snapshot.toolCallId) {
                throw new Error('[SCENARIO] Missing toolCallId for tool message');
            }
            return {
                role: 'tool',
                content: snapshot.content,
                toolCallId: snapshot.toolCallId,
                ...(snapshot.name && { name: snapshot.name }),
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'assistant': {
            return {
                role: 'assistant',
                content: snapshot.content ?? null,
                ...(snapshot.toolCalls && {
                    toolCalls: snapshot.toolCalls.map(tc => ({
                        id: tc.id ?? '',
                        type: 'function' as const,
                        function: {
                            name: tc.name ?? '',
                            arguments: tc.arguments ?? ''
                        }
                    }))
                }),
                ...(metadata && { metadata }),
                timestamp
            };
        }
    }
}

export function hydrateResponseSnapshot(snapshot: IScenarioResponseSnapshot): {
    message?: TUniversalMessage;
    raw?: IRawProviderResponse;
    stream?: Array<{ index: number; delta: TUniversalMessage; timestamp: number }>;
} {
    return {
        raw: snapshot.raw ? structuredClone(snapshot.raw) : undefined,
        message: snapshot.message ? deserializeMessage(snapshot.message) : undefined,
        stream: snapshot.stream?.map(chunk => ({
            index: chunk.index,
            timestamp: chunk.timestamp,
            delta: deserializeMessage(chunk.delta)
        }))
    };
}

export function serializeResponseSnapshot(response: {
    message?: TUniversalMessage;
    raw?: IRawProviderResponse;
    stream?: Array<{ index: number; delta: TUniversalMessage; timestamp: number }>;
}): IScenarioResponseSnapshot {
    return {
        message: response.message ? serializeMessage(response.message) : undefined,
        raw: response.raw ? structuredClone(response.raw) : undefined,
        stream: response.stream?.map(chunk => ({
            index: chunk.index,
            delta: serializeMessage(chunk.delta),
            timestamp: chunk.timestamp
        }))
    };
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
        if (message.name) base.name = message.name;
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


