import type { IToolCall } from '@robota-sdk/agent-core';
import { parseGemmaPseudoCommandEnvelopes } from './pseudo-command-envelope';
import {
  consumeGemmaPseudoControlBlock,
  consumeGemmaPseudoToolTag,
  createGemmaPseudoStartMarkers,
  findGemmaDeclaredToolName,
  findNextGemmaPseudoStartMarker,
  longestGemmaPseudoStartPrefixSuffixLength,
  parseGemmaPseudoTag,
} from './pseudo-tool-call-tag-parser';
import type {
  IGemmaConsumedPseudoBlock,
  IGemmaParsedPseudoTag,
  IGemmaPseudoProjectionOptions,
  TGemmaJsonValue,
} from './pseudo-tool-call-types';

const DEFAULT_CALL_ID_PREFIX = 'gemma_call';

export interface IGemmaPseudoToolCallProjection {
  visibleText: string;
  toolCalls: IToolCall[];
  removedToolCallText: boolean;
  rawToolCallTextParts: string[];
}

export interface IGemmaPseudoToolCallProjectorOptions {
  toolNames: readonly string[];
  callIdPrefix?: string;
  startCallIndex?: number;
}

interface IProjectionState {
  visibleParts: string[];
  toolCalls: IToolCall[];
  rawToolCallTextParts: string[];
  removedToolCallText: boolean;
}

interface IProjectTagResult {
  cursor: number;
  completed: boolean;
}

export function projectGemmaPseudoToolCallText(
  rawText: string,
  options: IGemmaPseudoToolCallProjectorOptions,
  projectionOptions: IGemmaPseudoProjectionOptions,
): IGemmaPseudoToolCallProjection {
  const state = createProjectionState();
  const markers = createGemmaPseudoStartMarkers(options.toolNames);
  let cursor = 0;

  while (cursor < rawText.length) {
    const nextMarker = findNextGemmaPseudoStartMarker(rawText, cursor, markers);
    if (nextMarker === -1) {
      appendVisibleTail(state, rawText.slice(cursor), projectionOptions, markers);
      break;
    }

    appendVisibleTail(state, rawText.slice(cursor, nextMarker), projectionOptions, markers);
    const result = projectTagAt(rawText, nextMarker, state, options, projectionOptions);
    if (!result.completed) {
      break;
    }
    cursor = result.cursor;
  }

  return {
    visibleText: state.visibleParts.join(''),
    toolCalls: state.toolCalls,
    rawToolCallTextParts: state.rawToolCallTextParts,
    removedToolCallText: state.removedToolCallText,
  };
}

function projectTagAt(
  rawText: string,
  tagStart: number,
  state: IProjectionState,
  options: IGemmaPseudoToolCallProjectorOptions,
  projectionOptions: IGemmaPseudoProjectionOptions,
): IProjectTagResult {
  const tag = parseGemmaPseudoTag(rawText, tagStart);
  if (!tag) {
    return projectMalformedTag(rawText, tagStart, state, projectionOptions);
  }
  const toolName = findGemmaDeclaredToolName(tag.tagName, options.toolNames);
  if (toolName) {
    return projectToolTag(rawText, tag, toolName, state, options);
  }
  return projectXmlArtifact(rawText, tagStart, tag, state, options, projectionOptions);
}

function projectMalformedTag(
  rawText: string,
  tagStart: number,
  state: IProjectionState,
  projectionOptions: IGemmaPseudoProjectionOptions,
): IProjectTagResult {
  if (!projectionOptions.final) {
    return { cursor: tagStart, completed: false };
  }
  state.visibleParts.push(rawText[tagStart] ?? '');
  return { cursor: tagStart + 1, completed: true };
}

function projectXmlArtifact(
  rawText: string,
  tagStart: number,
  tag: IGemmaParsedPseudoTag,
  state: IProjectionState,
  options: IGemmaPseudoToolCallProjectorOptions,
  projectionOptions: IGemmaPseudoProjectionOptions,
): IProjectTagResult {
  const block = consumeGemmaPseudoControlBlock(rawText, tag, projectionOptions);
  if (!block.complete && !projectionOptions.final) {
    return { cursor: tagStart, completed: false };
  }

  const rawControlText = rawText.slice(tagStart, block.end);
  const rawPartCount = state.rawToolCallTextParts.length;
  state.removedToolCallText = true;
  appendCommandEnvelopeToolCall(state, rawControlText, options);
  mergeProjection(state, projectControlBlockInner(block, state, options));
  if (state.rawToolCallTextParts.length === rawPartCount) {
    state.rawToolCallTextParts.push(rawControlText);
  }
  return { cursor: block.end, completed: true };
}

function projectControlBlockInner(
  block: IGemmaConsumedPseudoBlock,
  state: IProjectionState,
  options: IGemmaPseudoToolCallProjectorOptions,
): IGemmaPseudoToolCallProjection {
  return projectGemmaPseudoToolCallText(
    block.innerText,
    {
      ...options,
      startCallIndex: getNextCallIndex(state, options),
    },
    { final: true },
  );
}

function projectToolTag(
  rawText: string,
  tag: IGemmaParsedPseudoTag,
  toolName: string,
  state: IProjectionState,
  options: IGemmaPseudoToolCallProjectorOptions,
): IProjectTagResult {
  const rawToolTag = consumeGemmaPseudoToolTag(rawText, tag);
  appendToolCall(state, toolName, tag.attributes, rawToolTag.rawText, options);
  return { cursor: rawToolTag.end, completed: true };
}

function appendVisibleTail(
  state: IProjectionState,
  tail: string,
  options: IGemmaPseudoProjectionOptions,
  markers: readonly string[],
): void {
  if (tail.length === 0) {
    return;
  }
  if (options.final) {
    state.visibleParts.push(tail);
    return;
  }
  const heldLength = longestGemmaPseudoStartPrefixSuffixLength(tail, markers);
  state.visibleParts.push(tail.slice(0, tail.length - heldLength));
}

function appendToolCall(
  state: IProjectionState,
  toolName: string,
  args: Record<string, TGemmaJsonValue>,
  rawText: string,
  options: IGemmaPseudoToolCallProjectorOptions,
): void {
  if (Object.keys(args).length === 0) {
    return;
  }
  state.toolCalls.push(createToolCall(toolName, args, options, state));
  state.rawToolCallTextParts.push(rawText);
  state.removedToolCallText = true;
}

function appendCommandEnvelopeToolCall(
  state: IProjectionState,
  rawText: string,
  options: IGemmaPseudoToolCallProjectorOptions,
): void {
  const commands = parseGemmaPseudoCommandEnvelopes(rawText, options.toolNames);
  for (const command of commands) {
    state.toolCalls.push(createToolCall(command.toolName, command.args, options, state));
    state.rawToolCallTextParts.push(rawText);
  }
}

function createToolCall(
  toolName: string,
  args: Record<string, TGemmaJsonValue>,
  options: IGemmaPseudoToolCallProjectorOptions,
  state: IProjectionState,
): IToolCall {
  return {
    id: `${options.callIdPrefix ?? DEFAULT_CALL_ID_PREFIX}_${getNextCallIndex(state, options)}`,
    type: 'function',
    function: {
      name: toolName,
      arguments: JSON.stringify(args),
    },
  };
}

function createProjectionState(): IProjectionState {
  return {
    visibleParts: [],
    toolCalls: [],
    rawToolCallTextParts: [],
    removedToolCallText: false,
  };
}

function mergeProjection(
  state: IProjectionState,
  projection: IGemmaPseudoToolCallProjection,
): void {
  state.toolCalls.push(...projection.toolCalls);
  state.rawToolCallTextParts.push(...projection.rawToolCallTextParts);
  state.removedToolCallText = state.removedToolCallText || projection.removedToolCallText;
}

function getNextCallIndex(
  state: IProjectionState,
  options: IGemmaPseudoToolCallProjectorOptions,
): number {
  return (options.startCallIndex ?? 0) + state.toolCalls.length;
}
