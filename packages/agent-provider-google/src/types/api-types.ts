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
  contents: IGoogleContent[];
  tools?: IGoogleTool[];
  systemInstruction?: IGoogleContent;
  generationConfig?: IGoogleModelConfig;
}

export interface IGoogleStreamGenerateContentRequest extends IGoogleGenerateContentRequest {
  // Streaming uses the same request structure
}

// Content Types
export interface IGoogleContent {
  parts: IGooglePart[];
  role?: 'user' | 'model';
}

export interface IGooglePart {
  text?: string;
  functionCall?: IGoogleFunctionCall;
  functionResponse?: IGoogleFunctionResponse;
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
  functionDeclarations: IGoogleFunctionDeclaration[];
}

export interface IGoogleFunctionDeclaration {
  name: string;
  description?: string;
  parameters: IGoogleFunctionParameters;
}

export interface IGoogleFunctionParameters {
  type: 'object';
  properties: Record<string, IGooglePropertySchema>;
  required?: string[];
}

export interface IGooglePropertySchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: IGooglePropertySchema;
  properties?: Record<string, IGooglePropertySchema>;
}

// Response Types
export interface IGoogleGenerateContentResponse {
  candidates: IGoogleCandidate[];
  promptFeedback?: IGooglePromptFeedback;
  usageMetadata?: IGoogleUsageMetadata;
}

export interface IGoogleCandidate {
  content: IGoogleContent;
  finishReason?: TGoogleFinishReason;
  index: number;
  safetyRatings?: IGoogleSafetyRating[];
  citationMetadata?: IGoogleCitationMetadata;
}

export type TGoogleFinishReason =
  | 'FINISH_REASON_UNSPECIFIED'
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'OTHER';

export interface IGoogleSafetyRating {
  category: TGoogleHarmCategory;
  probability: TGoogleHarmProbability;
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
  citationSources: IGoogleCitationSource[];
}

export interface IGoogleCitationSource {
  startIndex?: number;
  endIndex?: number;
  uri?: string;
  license?: string;
}

export interface IGooglePromptFeedback {
  blockReason?: TGoogleBlockReason;
  safetyRatings?: IGoogleSafetyRating[];
}

export type TGoogleBlockReason = 'BLOCK_REASON_UNSPECIFIED' | 'SAFETY' | 'OTHER';

export interface IGoogleUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

// Streaming Types
export interface IGoogleStreamChunk {
  candidates?: IGoogleCandidate[];
  promptFeedback?: IGooglePromptFeedback;
  usageMetadata?: IGoogleUsageMetadata;
}

// Error Types
export interface IGoogleError {
  error: {
    code: number;
    message: string;
    status: string;
    details?: IGoogleErrorDetail[];
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
  usage?: IGoogleUsageMetadata;
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
  contents: IGoogleContent[];
  systemInstruction?: IGoogleContent;
}

// Stream Context for Managing State
export interface IGoogleStreamContext {
  currentMessage: string;
  currentToolCalls: IGoogleToolCall[];
  isComplete: boolean;
  usage?: IGoogleUsageMetadata;
}
