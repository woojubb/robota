/**
 * Google AI API-specific type definitions
 * 
 * This file contains type definitions specific to Google AI's Gemini API,
 * ensuring complete type safety without any/unknown types.
 */

// Google AI Request Types
export interface GoogleModelConfig {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
    responseMimeType?: string;
}

export interface GoogleGenerateContentRequest {
    contents: GoogleContent[];
    tools?: GoogleTool[];
    systemInstruction?: GoogleContent;
    generationConfig?: GoogleModelConfig;
}

export interface GoogleStreamGenerateContentRequest extends GoogleGenerateContentRequest {
    // Streaming uses the same request structure
}

// Content Types
export interface GoogleContent {
    parts: GooglePart[];
    role?: 'user' | 'model';
}

export interface GooglePart {
    text?: string;
    functionCall?: GoogleFunctionCall;
    functionResponse?: GoogleFunctionResponse;
}

export interface GoogleFunctionCall {
    name: string;
    args: Record<string, string | number | boolean | object>;
}

export interface GoogleFunctionResponse {
    name: string;
    response: Record<string, string | number | boolean | object>;
}

// Tool Types
export interface GoogleTool {
    functionDeclarations: GoogleFunctionDeclaration[];
}

export interface GoogleFunctionDeclaration {
    name: string;
    description?: string;
    parameters: GoogleFunctionParameters;
}

export interface GoogleFunctionParameters {
    type: 'object';
    properties: Record<string, GooglePropertySchema>;
    required?: string[];
}

export interface GooglePropertySchema {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: string[];
    items?: GooglePropertySchema;
    properties?: Record<string, GooglePropertySchema>;
}

// Response Types
export interface GoogleGenerateContentResponse {
    candidates: GoogleCandidate[];
    promptFeedback?: GooglePromptFeedback;
    usageMetadata?: GoogleUsageMetadata;
}

export interface GoogleCandidate {
    content: GoogleContent;
    finishReason?: GoogleFinishReason;
    index: number;
    safetyRatings?: GoogleSafetyRating[];
    citationMetadata?: GoogleCitationMetadata;
}

export type GoogleFinishReason =
    | 'FINISH_REASON_UNSPECIFIED'
    | 'STOP'
    | 'MAX_TOKENS'
    | 'SAFETY'
    | 'RECITATION'
    | 'OTHER';

export interface GoogleSafetyRating {
    category: GoogleHarmCategory;
    probability: GoogleHarmProbability;
}

export type GoogleHarmCategory =
    | 'HARM_CATEGORY_UNSPECIFIED'
    | 'HARM_CATEGORY_DEROGATORY'
    | 'HARM_CATEGORY_TOXICITY'
    | 'HARM_CATEGORY_VIOLENCE'
    | 'HARM_CATEGORY_SEXUAL'
    | 'HARM_CATEGORY_MEDICAL'
    | 'HARM_CATEGORY_DANGEROUS';

export type GoogleHarmProbability =
    | 'HARM_PROBABILITY_UNSPECIFIED'
    | 'NEGLIGIBLE'
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH';

export interface GoogleCitationMetadata {
    citationSources: GoogleCitationSource[];
}

export interface GoogleCitationSource {
    startIndex?: number;
    endIndex?: number;
    uri?: string;
    license?: string;
}

export interface GooglePromptFeedback {
    blockReason?: GoogleBlockReason;
    safetyRatings?: GoogleSafetyRating[];
}

export type GoogleBlockReason =
    | 'BLOCK_REASON_UNSPECIFIED'
    | 'SAFETY'
    | 'OTHER';

export interface GoogleUsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
}

// Streaming Types
export interface GoogleStreamChunk {
    candidates?: GoogleCandidate[];
    promptFeedback?: GooglePromptFeedback;
    usageMetadata?: GoogleUsageMetadata;
}

// Error Types
export interface GoogleError {
    error: {
        code: number;
        message: string;
        status: string;
        details?: GoogleErrorDetail[];
    };
}

export interface GoogleErrorDetail {
    '@type': string;
    reason?: string;
    domain?: string;
    metadata?: Record<string, string>;
}

// Provider Configuration
export interface GoogleLogData {
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
export interface GoogleToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

// Message Conversion Types
export interface GoogleMessageConversionResult {
    contents: GoogleContent[];
    systemInstruction?: GoogleContent;
}

// Stream Context for Managing State
export interface GoogleStreamContext {
    currentMessage: string;
    currentToolCalls: GoogleToolCall[];
    isComplete: boolean;
    usage?: GoogleUsageMetadata;
} 