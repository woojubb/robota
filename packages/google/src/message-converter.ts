import type {
    Content,
    Part,
    FunctionCall,
    FunctionDeclaration,
    EnhancedGenerateContentResponse
} from '@google/generative-ai';
import type {
    TUniversalMessage,
    IToolSchema,
    IAssistantMessage,
    IUserMessage,
    ISystemMessage,
    IToolMessage,
    TUniversalMessagePart
} from '@robota-sdk/agents';

const RANDOM_ID_RADIX = 36;
const RANDOM_ID_LENGTH = 9;

/**
 * Maps universal message parts to Gemini-compatible parts.
 * Supports text and inline image parts; throws on unsupported part types.
 */
export function mapMessagePartsToGeminiParts(
    message: IUserMessage | IAssistantMessage | ISystemMessage | IToolMessage
): Part[] {
    const parts: Part[] = [];
    const messageParts = message.parts ?? [];
    for (const part of messageParts) {
        if (part.type === 'text') {
            parts.push({ text: part.text });
            continue;
        }
        if (part.type === 'image_inline') {
            parts.push({
                inlineData: {
                    mimeType: part.mimeType,
                    data: part.data
                }
            });
            continue;
        }
        throw new Error(`Google provider does not support image URI parts directly: ${part.uri}`);
    }
    if (parts.length === 0 && typeof message.content === 'string' && message.content.length > 0) {
        parts.push({ text: message.content });
    }
    return parts;
}

/**
 * Converts an array of universal messages to the Gemini Content format.
 *
 * IMPORTANT: Google Gemini allows content with function calls.
 * Content can be empty string or text, but NOT null.
 */
export function convertToGeminiFormat(messages: TUniversalMessage[]): Content[] {
    return messages.map(msg => {
        if (msg.role === 'user') {
            return {
                role: 'user',
                parts: mapMessagePartsToGeminiParts(msg as IUserMessage)
            };
        } else if (msg.role === 'assistant') {
            return convertAssistantMessage(msg as IAssistantMessage);
        } else if (msg.role === 'tool') {
            const toolMessage = msg as IToolMessage;
            return {
                role: 'user',
                parts: mapMessagePartsToGeminiParts(toolMessage)
            };
        } else {
            const systemMessage = msg as ISystemMessage;
            const systemParts = mapMessagePartsToGeminiParts(systemMessage);
            if (systemParts.length === 0) {
                systemParts.push({ text: `System: ${systemMessage.content || ''}` });
            }
            return {
                role: 'user',
                parts: systemParts
            };
        }
    });
}

function convertAssistantMessage(assistantMsg: IAssistantMessage): Content {
    const parts: Part[] = [];
    const mappedAssistantParts = mapMessagePartsToGeminiParts(assistantMsg);
    for (const mappedPart of mappedAssistantParts) {
        parts.push(mappedPart);
    }
    if (parts.length === 0 && assistantMsg.content) {
        parts.push({ text: assistantMsg.content });
    }
    if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        assistantMsg.toolCalls.forEach(tc => {
            parts.push({
                functionCall: {
                    name: tc.function.name,
                    args: JSON.parse(tc.function.arguments) as object
                }
            });
        });
    }
    return {
        role: 'model',
        parts
    };
}

/** Generates a unique call identifier for function call responses. */
export function generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(RANDOM_ID_RADIX).substr(2, RANDOM_ID_LENGTH)}`;
}

/** Converts a Gemini API response into a universal message. */
export function convertFromGeminiResponse(response: EnhancedGenerateContentResponse): TUniversalMessage {
    const candidate = response.candidates?.[0];
    if (!candidate) {
        throw new Error('No candidate in Gemini response');
    }

    const content = candidate.content;
    if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('No content in Gemini response');
    }

    const textValues: string[] = [];
    const messageParts: TUniversalMessagePart[] = [];
    const collectedFunctionCalls: FunctionCall[] = [];

    for (const p of content.parts) {
        if (typeof p.text === 'string') {
            textValues.push(p.text);
            messageParts.push({ type: 'text', text: p.text });
        }
        if (p.inlineData && typeof p.inlineData.data === 'string') {
            messageParts.push({
                type: 'image_inline',
                data: p.inlineData.data,
                mimeType: p.inlineData.mimeType
            });
        }
        if (p.functionCall) {
            collectedFunctionCalls.push(p.functionCall);
        }
    }

    const result: TUniversalMessage = {
        role: 'assistant',
        content: textValues.length > 0 ? textValues.join('') : null,
        parts: messageParts,
        timestamp: new Date()
    };

    if (collectedFunctionCalls.length > 0) {
        const assistantResult = result as IAssistantMessage;
        assistantResult.toolCalls = collectedFunctionCalls.map((fc) => ({
            id: generateCallId(),
            type: 'function' as const,
            function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args)
            }
        }));
    }

    if (response.usageMetadata) {
        result.metadata = {
            promptTokens: response.usageMetadata.promptTokenCount,
            completionTokens: response.usageMetadata.candidatesTokenCount,
            totalTokens: response.usageMetadata.totalTokenCount
        };
    }

    return result;
}

/** Converts tool schemas to Gemini function declarations. */
export function convertToolsToGeminiFormat(tools: IToolSchema[]): FunctionDeclaration[] {
    return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as FunctionDeclaration['parameters']
    }));
}
