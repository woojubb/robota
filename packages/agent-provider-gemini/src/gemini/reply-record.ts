import { PROVIDER_CONTINUATION_METADATA_KEY } from '@robota-sdk/agent-core';

import type { GenerateContentResponse, Part } from '@google/genai';
import type { IAssistantMessage, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * What a whole reply said beyond its text. A streamed reply spreads this over chunks, and grounding
 * can arrive on a chunk with no parts, so it is gathered per reply rather than read off any one chunk.
 */
export interface IGeminiReplyRecord {
  parts: Part[];
  queries: Set<string>;
  citations: Set<string>;
  searchSuggestionsHtml?: string;
}

export function createGeminiReplyRecord(): IGeminiReplyRecord {
  return { parts: [], queries: new Set(), citations: new Set() };
}

/** `converted` is that response as a universal message: its tool calls hold the IDs history will use. */
export function recordGeminiResponse(
  record: IGeminiReplyRecord,
  response: GenerateContentResponse,
  converted: TUniversalMessage | undefined,
): void {
  const candidate = response.candidates?.[0];
  const callIds =
    converted?.role === 'assistant' ? (converted.toolCalls ?? []).map((call) => call.id) : [];
  let callIndex = 0;
  for (const part of candidate?.content?.parts ?? []) {
    for (const query of readSearchToolQueries(part)) record.queries.add(query);
    if (part.inlineData !== undefined || part.fileData !== undefined) continue;
    if (part.functionCall === undefined) {
      record.parts.push(part);
      continue;
    }
    const id = callIds[callIndex];
    callIndex += 1;
    record.parts.push(
      id === undefined ? part : { ...part, functionCall: { ...part.functionCall, id } },
    );
  }
  const grounding = candidate?.groundingMetadata;
  for (const query of grounding?.webSearchQueries ?? []) record.queries.add(query);
  for (const chunk of grounding?.groundingChunks ?? []) {
    if (chunk.web?.uri !== undefined) record.citations.add(chunk.web.uri);
  }
  const html = grounding?.searchEntryPoint?.renderedContent;
  if (html !== undefined) record.searchSuggestionsHtml = html;
}

function readSearchToolQueries(part: Part): string[] {
  if (part.toolCall?.toolType !== 'GOOGLE_SEARCH_WEB') return [];
  const queries = part.toolCall.args?.['queries'];
  return Array.isArray(queries)
    ? queries.filter((query): query is string => typeof query === 'string')
    : [];
}

/**
 * The metadata a recorded reply adds to its message. Search accounting has the shape Qwen's parser
 * reports. A query is the unit Google bills on Gemini 3 and the only count a response gives.
 */
export function geminiReplyMetadata(
  record: IGeminiReplyRecord,
  googleSearch: boolean,
): NonNullable<TUniversalMessage['metadata']> {
  const continuation = encodeGeminiContinuation(record.parts);
  return {
    ...(continuation !== undefined && { [PROVIDER_CONTINUATION_METADATA_KEY]: continuation }),
    ...(googleSearch && {
      providerBuiltInToolsEnabled: ['google_search'],
      geminiWebSearchCalls: record.queries.size,
      ...(record.queries.size > 0 && {
        providerBuiltInToolsUsed: ['google_search'],
        geminiWebSearchQueries: [...record.queries],
      }),
      ...(record.citations.size > 0 && { geminiWebSearchCitations: [...record.citations] }),
      ...(record.searchSuggestionsHtml !== undefined && {
        geminiSearchSuggestionsHtml: record.searchSuggestionsHtml,
      }),
    }),
  };
}

/**
 * The model's own parts, for the next request to send back as they came: a signed function call is
 * refused without its signature, and server-side tool steps are to be echoed. A plain reply needs
 * neither, so it is not stored twice.
 */
function encodeGeminiContinuation(parts: readonly Part[]): string | undefined {
  const needsReturn = parts.some(
    (part) =>
      part.toolCall !== undefined ||
      part.toolResponse !== undefined ||
      (part.functionCall !== undefined && part.thoughtSignature !== undefined),
  );
  return needsReturn ? JSON.stringify({ geminiParts: parts }) : undefined;
}

/**
 * The parts to send back for a message, or undefined to rebuild them from the message. A continuation
 * from another provider, or parts that no longer say what the message says because something rewrote
 * it, are not sent: the message is what the conversation holds.
 */
export function decodeGeminiContinuation(message: IAssistantMessage): Part[] | undefined {
  const encoded = message.metadata?.[PROVIDER_CONTINUATION_METADATA_KEY];
  if (typeof encoded !== 'string') return undefined;
  const parts = parseGeminiParts(encoded);
  if (parts === undefined) return undefined;
  const text = parts.map((part) => part.text ?? '').join('');
  const callIds = parts.flatMap((part) => (part.functionCall ? [part.functionCall.id] : []));
  const messageCallIds = (message.toolCalls ?? []).map((call) => call.id);
  const sameCalls =
    callIds.length === messageCallIds.length &&
    callIds.every((id, index) => id === messageCallIds[index]);
  return text === (message.content ?? '') && sameCalls ? parts : undefined;
}

function parseGeminiParts(encoded: string): Part[] | undefined {
  try {
    const parsed = JSON.parse(encoded) as { geminiParts?: unknown };
    return Array.isArray(parsed.geminiParts) ? (parsed.geminiParts as Part[]) : undefined;
  } catch {
    return undefined;
  }
}
