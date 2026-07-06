/**
 * Calls the active LLM provider to author a workflow spec from a natural-language description.
 * The provider *authors* a structured, JSON-only spec; it never executes anything.
 */
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createSystemMessage, createUserMessage } from '@robota-sdk/agent-core';

const MAX_AUTHORING_TOKENS = 2048;

export type TAuthorResult =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly error: string };

/**
 * The system prompt instructs the provider to emit ONLY a JSON object matching the authoring spec,
 * composing the listed nodes and (when nothing fits) defining prompt-backed `newNodes`.
 */
function buildAuthoringSystemPrompt(catalogText: string): string {
  return [
    'You are a workflow author. Given a natural-language request, design a linear DAG workflow and',
    'return ONLY a JSON object (no prose, no code fences) matching this shape:',
    '{',
    '  "name": "kebab-or-snake identifier (letters, digits, - and _ only)",',
    '  "description": "one short line",',
    '  "pipeline": [ { "nodeType": "<type>", "config": { ... optional } }, ... ],',
    '  "newNodes": [ { "nodeType", "displayName", "systemPromptTemplate", "inputPorts":[{"key"}], "outputPort":{"key"} } ],',
    '  "sampleInput": { "text": "an example input to run with" }',
    '}',
    '',
    'Rules:',
    '- The pipeline is executed left-to-right; adjacent nodes are auto-wired by their default ports.',
    '- Start from an "input" node and end with a "text-output" node unless the request says otherwise.',
    '- Prefer the existing nodes below. Only define a "newNodes" prompt-backed node when NO existing',
    '  node fits; reference it by its nodeType in the pipeline. Omit "newNodes" entirely if unused.',
    '- "systemPromptTemplate" may reference an input port with {{key}}.',
    '',
    'Available nodes:',
    catalogText,
  ].join('\n');
}

/**
 * Author a workflow spec. Returns the raw JSON string from the provider (validated/parsed by the
 * caller). Provider/transport failures are returned as structured errors, never thrown.
 */
export async function authorWorkflowSpec(
  provider: IAIProvider,
  description: string,
  catalogText: string,
  model?: string,
): Promise<TAuthorResult> {
  let response;
  try {
    response = await provider.chat(
      [
        createSystemMessage(buildAuthoringSystemPrompt(catalogText)),
        createUserMessage(description),
      ],
      {
        maxTokens: MAX_AUTHORING_TOKENS,
        responseFormat: { type: 'json_object' },
        ...(model ? { model } : {}),
      },
    );
  } catch (err) {
    // allow-fallback: provider/transport failure surfaced as a structured authoring error
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `provider call failed: ${detail}` };
  }

  const content = typeof response.content === 'string' ? response.content.trim() : '';
  if (content === '') {
    return { ok: false, error: 'provider returned an empty response' };
  }
  return { ok: true, raw: content };
}
