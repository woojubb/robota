import { FunctionCallingConfigMode } from '@google/genai';

import type { Content, GenerateContentParameters, Part, Tool } from '@google/genai';
import type { IChatOptions, IProviderCapabilities } from '@robota-sdk/agent-core';

const SOURCE = 'gemini-generate-content';
const CONFIGURE_HINT =
  'Set the provider profile option nativeWebTools.webSearch to true (constructor option enableWebTools).';

/**
 * What a model can do with Google Search. Google documents search for Gemini 2 and later, and search
 * next to function calling for Gemini 3 and later only; the SDK refuses to ask for that combination
 * in Vertex mode. A model name this cannot read is not assumed to search.
 */
type TGoogleSearchReach = 'none' | 'alone' | 'with-functions';

function googleSearchReach(model: string, vertex: boolean): TGoogleSearchReach {
  const major = /^(?:models\/)?gemini-(\d+)/.exec(model)?.[1];
  if (major === undefined || Number(major) < 2) return 'none';
  return Number(major) >= 3 && !vertex ? 'with-functions' : 'alone';
}

interface IGoogleSearchRequest {
  enabled: boolean;
  model: string;
  vertex: boolean;
  options: IChatOptions | undefined;
  config: NonNullable<GenerateContentParameters['config']>;
  hasFunctionTools: boolean;
}

/**
 * Google Search rides on a request whose tool use is the model's free choice and that it can serve:
 * `none` forbids tools, a forced choice asks for a function the caller will run, and an image or JSON
 * reply is not one a grounded answer fits. A request that requires search where this model cannot run
 * it fails instead of going without.
 */
function includesGoogleSearch(request: IGoogleSearchRequest): boolean {
  const { enabled, model, vertex, options, config, hasFunctionTools } = request;
  if (!enabled || options?.nativeWebTools?.webSearch === false) return false;
  if (options?.toolChoice !== undefined && options.toolChoice !== 'auto') return false;
  if (config.responseModalities?.includes('IMAGE')) return false;
  if (config.responseMimeType === 'application/json') return false;
  const reach = googleSearchReach(model, vertex);
  if (reach === 'with-functions' || (reach === 'alone' && !hasFunctionTools)) return true;
  if (options?.nativeWebTools?.webSearch === true) {
    throw new Error(
      `Provider gemini cannot run Google Search on model ${model}${hasFunctionTools ? ' next to function tools' : ''}.`,
    );
  }
  return false;
}

/** The request's `tools` and `toolConfig`, with Google Search where it belongs. */
export function buildGeminiToolFields(
  request: IGoogleSearchRequest & { functionTools: Tool | undefined },
): Pick<NonNullable<GenerateContentParameters['config']>, 'tools' | 'toolConfig'> {
  const { functionTools, config } = request;
  const googleSearch = includesGoogleSearch(request);
  const tools: Tool[] = [
    ...(googleSearch ? [{ googleSearch: {} }] : []),
    ...(functionTools !== undefined ? [functionTools] : []),
  ];
  if (tools.length === 0) return {};
  if (googleSearch && functionTools !== undefined) {
    // Google's limit: with server-side tool context in play `AUTO` is refused and `VALIDATED` is the
    // default, and the flag is what returns the steps the next request has to send back.
    return {
      tools,
      toolConfig: {
        ...config.toolConfig,
        includeServerSideToolInvocations: true,
        functionCallingConfig: { mode: FunctionCallingConfigMode.VALIDATED },
      },
    };
  }
  return { tools };
}

/**
 * Server-side tool steps go back only on a request that asks for them. The SDK refuses them in Vertex
 * mode, and a request without the flag is not known to accept them: a forced summary, or a fallback to
 * a model that cannot combine tools, must not fail on that. A signed function call goes back either way.
 */
export function withoutServerSideToolSteps(contents: Content[]): Content[] {
  return contents.map((content) =>
    content.parts?.some(isServerSideToolStep)
      ? { ...content, parts: content.parts.filter((part) => !isServerSideToolStep(part)) }
      : content,
  );
}

function isServerSideToolStep(part: Part): boolean {
  return part.toolCall !== undefined || part.toolResponse !== undefined;
}

export function usesGoogleSearch(request: GenerateContentParameters): boolean {
  const tools = request.config?.tools;
  return (
    Array.isArray(tools) && tools.some((tool) => typeof tool === 'object' && 'googleSearch' in tool)
  );
}

/** Vendor-level capabilities, for the model the provider was built with. */
export function geminiProviderCapabilities(
  webToolsEnabled: boolean,
  defaultModel: string | undefined,
  vertex: boolean,
): IProviderCapabilities {
  return {
    functionCalling: { supported: true },
    nativeWebTools: {
      webSearch: webSearchCapability(webToolsEnabled, defaultModel, vertex),
      webFetch: {
        supported: false,
        enabled: false,
        source: SOURCE,
        reason: 'Gemini provider exposes Google Search only.',
      },
    },
  };
}

function webSearchCapability(
  webToolsEnabled: boolean,
  defaultModel: string | undefined,
  vertex: boolean,
): IProviderCapabilities['nativeWebTools']['webSearch'] {
  if (!webToolsEnabled) {
    return { supported: true, enabled: false, source: SOURCE, reason: CONFIGURE_HINT };
  }
  const reach = defaultModel === undefined ? 'alone' : googleSearchReach(defaultModel, vertex);
  if (reach === 'none') {
    return {
      supported: true,
      enabled: false,
      source: SOURCE,
      reason: `Model ${defaultModel ?? ''} is not known to run Google Search; requests go without it.`,
    };
  }
  if (reach === 'alone') {
    return {
      supported: true,
      enabled: true,
      source: SOURCE,
      reason:
        'Google Search cannot join function tools here (Gemini 3 and later on the Gemini API only), so a request with function tools goes without it.',
    };
  }
  return { supported: true, enabled: true, source: SOURCE };
}
