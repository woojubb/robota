/**
 * Types and interfaces for PlaygroundExecutor
 */

import type { TUniversalValue } from '@robota-sdk/agents';
import type { IToolSchema } from '@robota-sdk/agents';
import type { IVisualizationData } from './plugins/playground-history-plugin';

// Re-export types for external use
export type { IVisualizationData, IConversationEvent } from './plugins/playground-history-plugin';

export interface IPlaygroundTool {
    readonly name: string;
    readonly description: string;
    readonly schema?: IToolSchema;
    execute(params: TUniversalValue): Promise<TUniversalValue>;
}

export interface IPlaygroundPlugin {
    readonly name: string;
    readonly version: string;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
}

export interface IPlaygroundToolHookFlags {
    hooksEnabled: boolean;
}

export interface IPlaygroundAgentConfig {
    id?: string;
    name: string;
    aiProviders: import('@robota-sdk/agents').IAIProvider[];
    defaultModel: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        systemMessage?: string;
    };
    tools?: IPlaygroundTool[];
    plugins?: IPlaygroundPlugin[];
    systemMessage?: string;
    metadata?: Record<string, TUniversalValue>;
}

export interface IPlaygroundExecutorResult {
    success: boolean;
    response: string;
    duration: number;
    tokensUsed?: number;
    toolsExecuted?: string[];
    error?: Error;
    uiError?: IPlaygroundUiError;
    visualizationData?: IVisualizationData;
}

export type TPlaygroundMode = 'agent';

export type TPlaygroundUiErrorKind = 'user_message' | 'recoverable' | 'fatal';

export interface IPlaygroundUiError {
    kind: TPlaygroundUiErrorKind;
    message: string;
}

export function toPlaygroundUiError(input: Error | string): IPlaygroundUiError {
    const message = input instanceof Error ? input.message : input;

    const lowered = message.toLowerCase();
    if (lowered.includes('missing required') || lowered.includes('invalid') || lowered.includes('unknown tool')) {
        return { kind: 'user_message', message };
    }
    if (lowered.includes('[strict-policy]') || lowered.includes('[path-only]') || lowered.includes('no fallback')) {
        return { kind: 'fatal', message };
    }
    return { kind: 'recoverable', message };
}
