import type { IDagDefinition } from '@robota-sdk/dag-core';
import { findInputKey, type IDagChatCandidates } from './dag-chat-catalog.js';
import {
  allocateNodeId,
  appendEdge,
  appendNode,
  createAppliedResult,
  createDraftAccumulator,
  createDraftNode,
  createPromptSourceNode,
} from './dag-chat-node-factory.js';
import type { IDagChatDraftResult } from './dag-chat-draft-types.js';

const SOURCE_COLUMN = 0;
const TARGET_COLUMN = 1;
const FIRST_ROW = 0;

export function buildTextDraft(input: {
  definition: IDagDefinition;
  prompt: string;
  candidates: IDagChatCandidates;
}): IDagChatDraftResult | undefined {
  const accumulator = createDraftAccumulator(input.definition);
  const promptNode = createPromptSourceNode({
    baseId: 'prompt',
    prompt: input.prompt,
    promptSource: input.candidates.promptSource,
    usedNodeIds: accumulator.usedNodeIds,
    column: SOURCE_COLUMN,
    row: FIRST_ROW,
  });
  if (promptNode) {
    appendNode(accumulator, promptNode);
  }
  if (input.candidates.textNode) {
    const textNode = createDraftNode({
      entry: input.candidates.textNode,
      nodeId: allocateNodeId(input.candidates.textNode.nodeType, accumulator.usedNodeIds),
      column: TARGET_COLUMN,
      row: FIRST_ROW,
    });
    appendNode(accumulator, textNode);
    connectPromptToTextNode(accumulator, promptNode, textNode.nodeId, input);
  }
  if (accumulator.nodes.length === 0) {
    return undefined;
  }
  return createAppliedResult({ definition: input.definition, prompt: input.prompt, accumulator });
}

function connectPromptToTextNode(
  accumulator: ReturnType<typeof createDraftAccumulator>,
  promptNode: { nodeId: string } | undefined,
  textNodeId: string,
  input: { prompt: string; candidates: IDagChatCandidates },
): void {
  const textNode = input.candidates.textNode;
  const inputKey = findInputKey(textNode, 'text', ['prompt', 'text']);
  if (!inputKey) {
    return;
  }
  if (promptNode) {
    appendEdge(accumulator, {
      from: promptNode.nodeId,
      to: textNodeId,
      bindings: [{ outputKey: 'text', inputKey: inputKey.key }],
    });
    return;
  }
  const targetNode = accumulator.nodes.find((node) => node.nodeId === textNodeId);
  if (targetNode) {
    targetNode.config = { ...targetNode.config, [inputKey.key]: input.prompt };
  }
}
