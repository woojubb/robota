import type { IPromptRequest, IPromptResponse } from '@robota-sdk/dag-core';

export interface ICostEstimate {
    totalEstimatedCredits: number;
    perNode: Record<string, { nodeType: string; estimatedCredits: number }>;
}

export interface ICostPolicy {
    maxCreditsPerPrompt: number;
}

export interface IRetryPolicy {
    maxRetries: number;
    backoffMs: number;
    retryableErrors: string[];
}

export interface ITimeoutPolicy {
    promptTimeoutMs: number;
}

export interface IOrchestratorConfig {
    costPolicy?: ICostPolicy;
    retryPolicy?: IRetryPolicy;
    timeoutPolicy?: ITimeoutPolicy;
}

export interface IOrchestratedPromptRequest {
    promptRequest: IPromptRequest;
    config?: IOrchestratorConfig;
}

export interface IOrchestratedPromptResponse {
    promptResponse: IPromptResponse;
    costEstimate?: ICostEstimate;
}
