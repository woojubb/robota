import type { IRawProviderResponse, TUniversalMessageMetadata, TUniversalValue } from '@robota-sdk/agents';

export type TScenarioMode = 'record' | 'play' | 'none';
export type TScenarioPlayStrategy = 'hash' | 'sequential';

export interface IScenarioToolCallSnapshot {
    id?: string;
    name?: string;
    arguments?: string;
}

export interface IScenarioMessageSnapshot {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    name?: string;
    toolCallId?: string;
    toolCalls?: IScenarioToolCallSnapshot[];
    metadata?: TUniversalMessageMetadata;
    timestamp: number;
}

export interface IScenarioChatOptionsSnapshot {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    toolChoice?: string;
    stream?: boolean;
    tools?: Array<{ name?: string }>;
}

export interface IScenarioRequestSnapshot {
    messages: IScenarioMessageSnapshot[];
    options?: IScenarioChatOptionsSnapshot;
    metadata?: Record<string, TUniversalValue>;
}

export interface IScenarioResponseSnapshot {
    message?: IScenarioMessageSnapshot;
    raw?: IRawProviderResponse;
    stream?: Array<{
        index: number;
        delta: IScenarioMessageSnapshot;
        timestamp: number;
    }>;
}

export interface IScenarioProviderStep {
    kind: 'provider';
    stepId: string;
    requestHash: string;
    request: IScenarioRequestSnapshot;
    response: IScenarioResponseSnapshot;
    timestamp: number;
    tags?: string[];
    providerInfo?: {
        name: string;
        version: string;
    };
}

export interface IScenarioToolResultStep {
    kind: 'tool_result';
    stepId: string;
    toolCallId: string;
    toolName: string;
    /**
     * Tool arguments snapshot.
     * This is stored as a string to avoid relying on JSON parsing for determinism.
     */
    toolArguments: string;
    /**
     * The exact content that will be used as the `role:"tool"` message content.
     */
    toolMessageContent: string;
    success: boolean;
    errorMessage?: string;
    timestamp: number;
    tags?: string[];
}

export type IScenarioStep = IScenarioProviderStep | IScenarioToolResultStep;

export interface IScenarioRecord {
    scenarioId: string;
    version: number;
    steps: IScenarioStep[];
}


