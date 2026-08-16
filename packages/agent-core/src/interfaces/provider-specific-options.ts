/**
 * Vendor-specific request options, kept out of `provider.ts`.
 *
 * Split by responsibility rather than shaved: `provider.ts` is long past the size ceiling, and these
 * are the one part of it that describes particular VENDORS rather than the neutral contract every
 * provider implements. They are re-exported from `provider.ts`, so no consumer sees a difference.
 */

/**
 * Provider-specific configuration options
 */
export interface IProviderSpecificOptions {
  /** OpenAI specific options */
  openai?: {
    organization?: string;
    user?: string;
    stop?: string | string[];
    presencePenalty?: number;
    frequencyPenalty?: number;
    logitBias?: Record<string, number>;
    topP?: number;
    n?: number;
    stream?: boolean;
    suffix?: string;
    echo?: boolean;
    bestOf?: number;
    logprobs?: number;
  };

  /** Anthropic specific options */
  anthropic?: {
    stopSequences?: string[];
    topP?: number;
    topK?: number;
    metadata?: {
      userId?: string;
    };
  };

  /** Google specific options */
  google?: {
    candidateCount?: number;
    stopSequences?: string[];
    safetySettings?: Array<{
      category: string;
      threshold: string;
    }>;
    responseModalities?: Array<'TEXT' | 'IMAGE'>;
    topP?: number;
    topK?: number;
  };
}

/**
 * Callback for receiving text deltas during streaming.
 * Called for each text chunk as the model generates output.
 */
