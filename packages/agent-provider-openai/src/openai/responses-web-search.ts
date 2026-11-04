import type {
  IOpenAIResponsesMessageOutputItem,
  IOpenAIResponsesWebSearchCallOutputItem,
  TOpenAIResponsesOutputItem,
} from './responses-types';
import type { IOpenAIProviderOptions, IOpenAIResponsesReasoningOptions } from './types';
import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

// OpenAI's model pages list no web search for these (`gpt-4.1-nano`, `o1`, `o1-pro`, `o3-mini`; the
// `gpt-3.5` and `gpt-4` pages list no tools), verified 2026-11-04. A default-on profile on one of
// them would otherwise fail every turn. Dated snapshots match too.
const MODELS_WITHOUT_WEB_SEARCH = /^(?:gpt-3\.5|gpt-4(?:-|$)|gpt-4\.1-nano|o1(?:-|$)|o3-mini)/;

export interface IHostedWebSearchRequest {
  providerOptions: IOpenAIProviderOptions;
  chatOptions: IChatOptions | undefined;
  model: string;
  reasoning: IOpenAIResponsesReasoningOptions | undefined;
}

/** What a response says about its hosted web searches. */
export interface IOpenAIWebSearchUsage {
  calls: number;
  citations: string[];
}

/**
 * Whether the hosted `web_search` tool joins this request. Search rides on a request whose tool use
 * is the model's free choice: `none` forbids tools, and a forced choice asks for a function the
 * caller will run, which a hosted search could otherwise satisfy without one. A call can withhold it
 * (`nativeWebTools.webSearch: false`), minimal reasoning excludes it (per OpenAI's guide), and the
 * models above do not offer it.
 */
export function includesHostedWebSearch(request: IHostedWebSearchRequest): boolean {
  const toolChoice = request.chatOptions?.toolChoice;
  return (
    request.providerOptions.nativeWebTools?.webSearch === true &&
    request.chatOptions?.nativeWebTools?.webSearch !== false &&
    (toolChoice === undefined || toolChoice === 'auto') &&
    request.reasoning?.effort !== 'minimal' &&
    !MODELS_WITHOUT_WEB_SEARCH.test(request.model)
  );
}

export function createEmptyWebSearchUsage(): IOpenAIWebSearchUsage {
  return { calls: 0, citations: [] };
}

/**
 * Searches and cited URLs in a response's output. Only `search` actions are billed searches
 * (`open_page` and `find_in_page` read a page already found); an item with no action counts as one.
 * Citations are the unique `url_citation` URLs of the reply text, in first-seen order.
 */
export function collectWebSearchUsage(
  output: readonly TOpenAIResponsesOutputItem[],
): IOpenAIWebSearchUsage {
  const usage = createEmptyWebSearchUsage();
  for (const item of output) {
    if (isWebSearchCallItem(item)) {
      if (item.action?.type === undefined || item.action.type === 'search') {
        usage.calls += 1;
      }
    } else if (isMessageItem(item)) {
      for (const content of item.content) {
        if (content.type === 'output_text') {
          addCitations(usage, content.annotations);
        }
      }
    }
  }
  return usage;
}

/** Usage seen item by item adds up: each finished search item is one more search. */
export function addWebSearchUsage(
  target: IOpenAIWebSearchUsage,
  source: IOpenAIWebSearchUsage,
): void {
  target.calls += source.calls;
  addCitationUrls(target, source.citations);
}

/**
 * Two reports of the same response (the stream's items and its completed response) agree rather than
 * add up, so the larger search count stands and the citations are their union.
 */
export function mergeWebSearchUsage(
  target: IOpenAIWebSearchUsage,
  source: IOpenAIWebSearchUsage,
): void {
  target.calls = Math.max(target.calls, source.calls);
  addCitationUrls(target, source.citations);
}

/** Nothing when the request did not carry the tool: it cannot have searched, so nothing is claimed. */
export function webSearchMetadata(
  hostedWebSearch: boolean,
  usage: IOpenAIWebSearchUsage,
): NonNullable<TUniversalMessage['metadata']> {
  if (!hostedWebSearch) {
    return {};
  }
  return {
    providerBuiltInToolsEnabled: ['web_search'],
    openaiWebSearchCalls: usage.calls,
    ...(usage.calls > 0 && { providerBuiltInToolsUsed: ['web_search'] }),
    ...(usage.citations.length > 0 && { openaiWebSearchCitations: usage.citations }),
  };
}

function addCitations(
  usage: IOpenAIWebSearchUsage,
  annotations: ReadonlyArray<{ type: string; url?: string }> | undefined,
): void {
  const urls: string[] = [];
  for (const annotation of annotations ?? []) {
    if (annotation.type === 'url_citation' && typeof annotation.url === 'string') {
      urls.push(annotation.url);
    }
  }
  addCitationUrls(usage, urls);
}

function addCitationUrls(usage: IOpenAIWebSearchUsage, urls: readonly string[]): void {
  for (const url of urls) {
    if (!usage.citations.includes(url)) {
      usage.citations.push(url);
    }
  }
}

function isWebSearchCallItem(
  item: TOpenAIResponsesOutputItem,
): item is IOpenAIResponsesWebSearchCallOutputItem {
  return item.type === 'web_search_call';
}

function isMessageItem(
  item: TOpenAIResponsesOutputItem,
): item is IOpenAIResponsesMessageOutputItem {
  return item.type === 'message' && 'content' in item && Array.isArray(item.content);
}
