/**
 * Google AI API-specific type definitions
 * 
 * This file contains type definitions specific to Google AI's Gemini API,
 * ensuring complete type safety without any/unknown types.
 */

// Google AI Request Types
export interface IGoogleModelConfig {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
    responseMimeType?: string;
}

export interface IGoogleGenerateContentRequest {
    contents: GoogleContent[];
    tools?: GoogleTool[];
    systemInstruction?: GoogleContent;
    generationConfig?: GoogleModelConfig;
}

export interface IGoogleStreamGenerateContentRequest extends GoogleGenerateContentRequest {
    // Streaming uses the same request structure
}

// Content Types
export interface IGoogleContent {
    parts: GooglePart[];
    role?: 'user' | 'model';
}

export interface IGooglePart {
    text?: string;
    functionCall?: GoogleFunctionCall;
    functionResponse?: GoogleFunctionResponse;
}

export interface IGoogleFunctionCall {
    name: string;
    args: Record<string, string | number | boolean | object>;
}

export interface IGoogleFunctionResponse {
    name: string;
    response: Record<string, string | number | boolean | object>;
}

// Tool Types
export interface IGoogleTool {
    functionDeclarations: GoogleFunctionDeclaration[];
}

export interface IGoogleFunctionDeclaration {
    name: string;
    description?: string;
    parameters: GoogleFunctionParameters;
}

export interface IGoogleFunctionParameters {
    type: 'object';
    properties: Record<string, GooglePropertySchema>;
    required?: string[];
}

export interface IGooglePropertySchema {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: string[];
    items?: GooglePropertySchema;
    properties?: Record<string, GooglePropertySchema>;
}

// Response Types
export interface IGoogleGenerateContentResponse {
    candidates: GoogleCandidate[];
    promptFeedback?: GooglePromptFeedback;
    usageMetadata?: GoogleUsageMetadata;
}

export interface IGoogleCandidate {
    content: GoogleContent;
    finishReason?: GoogleFinishReason;
    index: number;
    safetyRatings?: GoogleSafetyRating[];
    citationMetadata?: GoogleCitationMetadata;
}

export type TGoogleFinishReason =
    | 'FINISH_REASON_UNSPECIFIED'
    | 'STOP'
    | 'MAX_TOKENS'
    | 'SAFETY'
    | 'RECITATION'
    | 'OTHER';

export interface IGoogleSafetyRating {
    category: GoogleHarmCategory;
    probability: GoogleHarmProbability;
}

export type TGoogleHarmCategory =
    | 'HARM_CATEGORY_UNSPECIFIED'
    | 'HARM_CATEGORY_DEROGATORY'
    | 'HARM_CATEGORY_TOXICITY'
    | 'HARM_CATEGORY_VIOLENCE'
    | 'HARM_CATEGORY_SEXUAL'
    | 'HARM_CATEGORY_MEDICAL'
    | 'HARM_CATEGORY_DANGEROUS';

export type TGoogleHarmProbability =
    | 'HARM_PROBABILITY_UNSPECIFIED'
    | 'NEGLIGIBLE'
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH';

export interface IGoogleCitationMetadata {
    citationSources: GoogleCitationSource[];
}

export interface IGoogleCitationSource {
    startIndex?: number;
    endIndex?: number;
    uri?: string;
    license?: string;
}

export interface IGooglePromptFeedback {
    blockReason?: GoogleBlockReason;
    safetyRatings?: GoogleSafetyRating[];
}

export type TGoogleBlockReason =
    | 'BLOCK_REASON_UNSPECIFIED'
    | 'SAFETY'
    | 'OTHER';

export interface IGoogleUsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
}

// Streaming Types
export interface IGoogleStreamChunk {
    candidates?: GoogleCandidate[];
    promptFeedback?: GooglePromptFeedback;
    usageMetadata?: GoogleUsageMetadata;
}

// Error Types
export interface IGoogleError {
    error: {
        code: number;
        message: string;
        status: string;
        details?: GoogleErrorDetail[];
    };
}

export interface IGoogleErrorDetail {
    '@type': string;
    reason?: string;
    domain?: string;
    metadata?: Record<string, string>;
}

// Provider Configuration
export interface IGoogleLogData {
    model: string;
    messagesCount: number;
    hasTools: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    timestamp: string;
    requestId?: string;
    usage?: GoogleUsageMetadata;
}

// Tool Call Types for Internal Processing
export interface IGoogleToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

// Message Conversion Types
export interface IGoogleMessageConversionResult {
    contents: GoogleContent[];
    systemInstruction?: GoogleContent;
}

// Stream Context for Managing State
export interface IGoogleStreamContext {
    currentMessage: string;
    currentToolCalls: GoogleToolCall[];
    isComplete: boolean;
    usage?: GoogleUsageMetadata;
} 