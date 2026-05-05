import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
  findInputKey,
  findOutputKey,
  formatInputBindingKey,
  type IDagChatCandidates,
} from './dag-chat-catalog.js';
import {
  allocateNodeId,
  appendEdge,
  appendNode,
  appendNodes,
  createAppliedResult,
  createDraftAccumulator,
  createDraftNode,
  createImageSourceNodes,
  createPromptSourceNode,
  createUnchangedResult,
} from './dag-chat-node-factory.js';
import type { ICatalogEntry, IDagChatDraftResult, IChatIntent } from './dag-chat-draft-types.js';

const SOURCE_COLUMN = 0;
const TARGET_COLUMN = 1;
const TARGET_ROW = 1;

export function buildImageDraft(input: {
  definition: IDagDefinition;
  prompt: string;
  intent: IChatIntent;
  candidates: IDagChatCandidates;
}): IDagChatDraftResult {
  const targetEntry = selectImageTarget(input.intent, input.candidates);
  if (!input.candidates.imageSource || !targetEntry) {
    return createNoImagePlanResult(input.definition);
  }
  const accumulator = createDraftAccumulator(input.definition);
  const sourceNodes = createImageSourceNodes({
    entry: input.candidates.imageSource,
    count: input.intent.wantsCompose ? input.intent.imageSourceCount : 1,
    usedNodeIds: accumulator.usedNodeIds,
  });
  appendNodes(accumulator, sourceNodes);
  const promptNode = createAndAppendPrompt(accumulator, input, sourceNodes.length);
  const targetNode = createDraftNode({
    entry: targetEntry,
    nodeId: allocateNodeId(targetEntry.nodeType, accumulator.usedNodeIds),
    column: TARGET_COLUMN,
    row: TARGET_ROW,
  });
  appendNode(accumulator, targetNode);
  connectImageInputs(
    accumulator,
    input.candidates.imageSource,
    targetEntry,
    sourceNodes,
    targetNode.nodeId,
  );
  connectPromptInput(accumulator, promptNode, targetEntry, targetNode.nodeId, input.prompt);
  return createAppliedResult({ definition: input.definition, prompt: input.prompt, accumulator });
}

function selectImageTarget(
  intent: IChatIntent,
  candidates: IDagChatCandidates,
): ICatalogEntry | undefined {
  if (intent.wantsCompose && candidates.imageCompose) {
    return candidates.imageCompose;
  }
  return candidates.imageEdit;
}

function createNoImagePlanResult(definition: IDagDefinition): IDagChatDraftResult {
  return createUnchangedResult({
    status: 'no-plan',
    definition,
    message: 'No image edit or compose node was found in the current catalog.',
    warnings: [
      {
        code: 'DAG_CHAT_NO_COMPATIBLE_PLAN',
        message: 'The current objectInfo catalog does not expose an image target node.',
      },
    ],
  });
}

function createAndAppendPrompt(
  accumulator: ReturnType<typeof createDraftAccumulator>,
  input: { prompt: string; intent: IChatIntent; candidates: IDagChatCandidates },
  row: number,
) {
  const promptNode = createPromptSourceNode({
    baseId: input.intent.wantsCompose ? 'compose_prompt' : 'edit_prompt',
    prompt: input.prompt,
    promptSource: input.candidates.promptSource,
    usedNodeIds: accumulator.usedNodeIds,
    column: SOURCE_COLUMN,
    row,
  });
  if (promptNode) {
    appendNode(accumulator, promptNode);
  }
  return promptNode;
}

function connectImageInputs(
  accumulator: ReturnType<typeof createDraftAccumulator>,
  sourceEntry: ICatalogEntry,
  targetEntry: ICatalogEntry,
  sourceNodes: { nodeId: string }[],
  targetNodeId: string,
): void {
  const imageOutputKey = findOutputKey(sourceEntry, 'image') ?? 'image';
  const imageInput = findInputKey(targetEntry, 'image', ['images', 'image']);
  if (!imageInput) {
    return;
  }
  for (let index = 0; index < sourceNodes.length; index += 1) {
    appendEdge(accumulator, {
      from: sourceNodes[index]!.nodeId,
      to: targetNodeId,
      bindings: [
        {
          outputKey: imageOutputKey,
          inputKey: formatInputBindingKey(imageInput, sourceNodes.length > 1 ? index : undefined),
        },
      ],
    });
  }
}

function connectPromptInput(
  accumulator: ReturnType<typeof createDraftAccumulator>,
  promptNode: { nodeId: string } | undefined,
  targetEntry: ICatalogEntry,
  targetNodeId: string,
  prompt: string,
): void {
  const promptInput = findInputKey(targetEntry, 'text', ['prompt', 'text']);
  if (!promptInput) {
    return;
  }
  if (promptNode) {
    appendEdge(accumulator, {
      from: promptNode.nodeId,
      to: targetNodeId,
      bindings: [{ outputKey: 'text', inputKey: promptInput.key }],
    });
    return;
  }
  const targetNode = accumulator.nodes.find((node) => node.nodeId === targetNodeId);
  if (targetNode) {
    targetNode.config = { ...targetNode.config, [promptInput.key]: prompt };
  }
}
