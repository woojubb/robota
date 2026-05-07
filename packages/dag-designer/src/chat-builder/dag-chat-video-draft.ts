import type { IDagDefinition, IDagNode } from '@robota-sdk/dag-core';
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
} from './dag-chat-node-factory.js';
import type {
  ICatalogEntry,
  IDagChatDraftResult,
  IChatIntent,
  IDraftAccumulator,
  IPortDescriptor,
} from './dag-chat-draft-types.js';

const SOURCE_COLUMN = 0;
const TARGET_COLUMN = 1;
const OUTPUT_COLUMN = 2;
const FIRST_ROW = 0;
const SECOND_ROW = 1;
const COMPOSE_PROMPT_ROW = 2;
const VIDEO_PROMPT_ROW = 3;

export function buildVideoDraft(input: {
  definition: IDagDefinition;
  prompt: string;
  intent: IChatIntent;
  candidates: IDagChatCandidates;
}): IDagChatDraftResult | undefined {
  if (!input.candidates.videoNode) {
    return undefined;
  }
  if (canBuildComposeVideo(input.intent, input.candidates)) {
    return buildComposeVideoDraft({
      definition: input.definition,
      prompt: input.prompt,
      intent: input.intent,
      candidates: input.candidates,
    });
  }
  return buildPromptVideoDraft({
    definition: input.definition,
    prompt: input.prompt,
    candidates: input.candidates,
  });
}

function canBuildComposeVideo(intent: IChatIntent, candidates: IDagChatCandidates): boolean {
  return Boolean(
    intent.wantsImage &&
      intent.wantsCompose &&
      candidates.imageSource &&
      candidates.imageCompose &&
      findOutputKey(candidates.imageSource, 'image') &&
      findOutputKey(candidates.imageCompose, 'image') &&
      findInputKey(candidates.imageCompose, 'image', ['images', 'image']),
  );
}

function buildComposeVideoDraft(input: {
  definition: IDagDefinition;
  prompt: string;
  intent: IChatIntent;
  candidates: IDagChatCandidates;
}): IDagChatDraftResult | undefined {
  const accumulator = createDraftAccumulator(input.definition);
  const composeNode = appendComposeStage(accumulator, input);
  if (!composeNode) {
    return undefined;
  }
  appendVideoStage(accumulator, {
    prompt: input.prompt,
    candidates: input.candidates,
    upstreamImageNode: composeNode,
    upstreamOutputKey: findOutputKey(input.candidates.imageCompose, 'image') ?? 'image',
  });
  return createAppliedResult({ definition: input.definition, prompt: input.prompt, accumulator });
}

function appendComposeStage(
  accumulator: IDraftAccumulator,
  input: {
    prompt: string;
    intent: IChatIntent;
    candidates: IDagChatCandidates;
  },
): IDagNode | undefined {
  const source = input.candidates.imageSource;
  const compose = input.candidates.imageCompose;
  const imageOutputKey = findOutputKey(source, 'image');
  const imageInput = findInputKey(compose, 'image', ['images', 'image']);
  if (!source || !compose || !imageOutputKey || !imageInput) {
    return undefined;
  }
  const sources = createImageSourceNodes({
    entry: source,
    count: input.intent.imageSourceCount,
    usedNodeIds: accumulator.usedNodeIds,
  });
  appendNodes(accumulator, sources);
  const composePrompt = appendPromptNode(accumulator, input, 'compose_prompt', COMPOSE_PROMPT_ROW);
  appendPromptNode(accumulator, input, 'video_prompt', VIDEO_PROMPT_ROW);
  const composeNode = createDraftNode({
    entry: compose,
    nodeId: allocateNodeId(compose.nodeType, accumulator.usedNodeIds),
    column: TARGET_COLUMN,
    row: SECOND_ROW,
  });
  appendNode(accumulator, composeNode);
  connectImageSources(accumulator, sources, composeNode.nodeId, imageOutputKey, imageInput);
  connectPrompt(accumulator, composePrompt, composeNode.nodeId, input.candidates.imageCompose);
  return composeNode;
}

function appendVideoStage(
  accumulator: IDraftAccumulator,
  input: {
    prompt: string;
    candidates: IDagChatCandidates;
    upstreamImageNode?: IDagNode;
    upstreamOutputKey?: string;
  },
): IDagNode | undefined {
  const video = input.candidates.videoNode;
  if (!video) {
    return undefined;
  }
  const videoNode = createDraftNode({
    entry: video,
    nodeId: allocateNodeId(video.nodeType, accumulator.usedNodeIds),
    column: input.upstreamImageNode ? OUTPUT_COLUMN : TARGET_COLUMN,
    row: input.upstreamImageNode ? COMPOSE_PROMPT_ROW : FIRST_ROW,
  });
  appendNode(accumulator, videoNode);
  connectVideoImage(accumulator, input.upstreamImageNode, videoNode.nodeId, input);
  const promptNode =
    findPromptNode(accumulator, 'video_prompt') ??
    appendPromptNode(
      accumulator,
      input,
      'video_prompt',
      input.upstreamImageNode ? VIDEO_PROMPT_ROW : FIRST_ROW,
    );
  connectPrompt(accumulator, promptNode, videoNode.nodeId, video);
  return videoNode;
}

function buildPromptVideoDraft(input: {
  definition: IDagDefinition;
  prompt: string;
  candidates: IDagChatCandidates;
}): IDagChatDraftResult | undefined {
  const accumulator = createDraftAccumulator(input.definition);
  const videoNode = appendVideoStage(accumulator, {
    prompt: input.prompt,
    candidates: input.candidates,
  });
  if (!videoNode) {
    return undefined;
  }
  return createAppliedResult({ definition: input.definition, prompt: input.prompt, accumulator });
}

function appendPromptNode(
  accumulator: IDraftAccumulator,
  input: { prompt: string; candidates: IDagChatCandidates },
  baseId: string,
  row: number,
): IDagNode | undefined {
  const promptNode = createPromptSourceNode({
    baseId,
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

function connectImageSources(
  accumulator: IDraftAccumulator,
  sources: IDagNode[],
  targetNodeId: string,
  outputKey: string,
  imageInput: IPortDescriptor,
): void {
  for (let index = 0; index < sources.length; index += 1) {
    appendEdge(accumulator, {
      from: sources[index]!.nodeId,
      to: targetNodeId,
      bindings: [{ outputKey, inputKey: formatInputBindingKey(imageInput, index) }],
    });
  }
}

function connectVideoImage(
  accumulator: IDraftAccumulator,
  upstreamImageNode: IDagNode | undefined,
  videoNodeId: string,
  input: { candidates: IDagChatCandidates; upstreamOutputKey?: string },
): void {
  const videoImageInput = findInputKey(input.candidates.videoNode, 'image', ['images', 'image']);
  if (!upstreamImageNode || !videoImageInput || !input.upstreamOutputKey) {
    return;
  }
  appendEdge(accumulator, {
    from: upstreamImageNode.nodeId,
    to: videoNodeId,
    bindings: [
      {
        outputKey: input.upstreamOutputKey,
        inputKey: formatInputBindingKey(videoImageInput, FIRST_ROW),
      },
    ],
  });
}

function connectPrompt(
  accumulator: IDraftAccumulator,
  promptNode: IDagNode | undefined,
  targetNodeId: string,
  targetEntry: ICatalogEntry | undefined,
): void {
  const promptInput = findInputKey(targetEntry, 'text', ['prompt', 'text']);
  if (!promptNode || !promptInput) {
    return;
  }
  appendEdge(accumulator, {
    from: promptNode.nodeId,
    to: targetNodeId,
    bindings: [{ outputKey: 'text', inputKey: promptInput.key }],
  });
}

function findPromptNode(accumulator: IDraftAccumulator, prefix: string): IDagNode | undefined {
  return accumulator.nodes.find((node) => node.nodeId.startsWith(`${prefix}_`));
}
