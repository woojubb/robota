import type { IToolCall, IToolSchema } from '@robota-sdk/agent-core';
import type {
  IOpenAICompatibleToolCallTextProjection,
  IOpenAICompatibleToolCallTextProjector,
} from '@robota-sdk/agent-provider-openai-compatible';
import { GemmaArgumentParser } from './tool-call-argument-parser';

const TOOL_CALL_START = '<|tool_call>';
const TOOL_CALL_END = '<tool_call|>';
const CALL_PREFIX = 'call:';
const DEFAULT_CALL_ID_PREFIX = 'gemma_call';

export interface IGemmaToolCallProjectorOptions {
  toolNames: readonly string[];
  callIdPrefix?: string;
}

export interface IGemmaToolCallProjection extends IOpenAICompatibleToolCallTextProjection {
  rawText: string;
}

interface IProjectionOptions {
  final: boolean;
}

interface IProjectionState {
  visibleParts: string[];
  toolCalls: IToolCall[];
  rawToolCallTextParts: string[];
  removedToolCallText: boolean;
}

export function createGemmaToolCallProjector(
  tools: readonly IToolSchema[] | undefined,
): GemmaToolCallProjector | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return new GemmaToolCallProjector({ toolNames: tools.map((tool) => tool.name) });
}

export function projectGemmaToolCallText(
  rawText: string,
  options: IGemmaToolCallProjectorOptions,
): IGemmaToolCallProjection {
  const result = projectText(rawText, options, { final: true });
  return toPublicProjection(rawText, result);
}

export class GemmaToolCallProjector implements IOpenAICompatibleToolCallTextProjector {
  private buffer = '';
  private emittedVisibleText = '';
  private readonly emittedToolCallIds = new Set<string>();

  constructor(private readonly options: IGemmaToolCallProjectorOptions) {}

  project(delta: string): IOpenAICompatibleToolCallTextProjection {
    if (delta.length === 0) {
      return emptyProjection();
    }

    this.buffer += delta;
    return this.projectVisibleText({ final: false });
  }

  flush(): IOpenAICompatibleToolCallTextProjection {
    return this.projectVisibleText({ final: true });
  }

  private projectVisibleText(options: IProjectionOptions): IOpenAICompatibleToolCallTextProjection {
    const result = projectText(this.buffer, this.options, options);
    const nextVisibleText = result.visibleParts.join('');
    const visibleText = nextVisibleText.slice(this.emittedVisibleText.length);
    this.emittedVisibleText = nextVisibleText;

    const rawToolCallTextParts: string[] = [];
    const toolCalls = result.toolCalls.filter((toolCall, index) => {
      if (this.emittedToolCallIds.has(toolCall.id)) {
        return false;
      }
      this.emittedToolCallIds.add(toolCall.id);
      const rawToolCallText = result.rawToolCallTextParts[index];
      if (rawToolCallText) {
        rawToolCallTextParts.push(rawToolCallText);
      }
      return true;
    });

    return {
      visibleText,
      toolCalls,
      removedToolCallText: rawToolCallTextParts.length > 0,
      ...(rawToolCallTextParts.length > 0 && {
        rawToolCallText: rawToolCallTextParts.join(''),
      }),
    };
  }
}

function projectText(
  rawText: string,
  options: IGemmaToolCallProjectorOptions,
  projectionOptions: IProjectionOptions,
): IProjectionState {
  const state = createProjectionState();
  const toolNames = new Set(options.toolNames);
  let cursor = 0;
  let projectedCallIndex = 0;

  while (cursor < rawText.length) {
    const nextMarker = rawText.indexOf(TOOL_CALL_START, cursor);
    if (nextMarker === -1) {
      appendVisibleTail(state, rawText.slice(cursor), projectionOptions);
      break;
    }

    appendVisibleTail(state, rawText.slice(cursor, nextMarker), projectionOptions);
    const afterStart = nextMarker + TOOL_CALL_START.length;
    const markerEnd = rawText.indexOf(TOOL_CALL_END, afterStart);
    if (markerEnd === -1) {
      if (projectionOptions.final) {
        state.visibleParts.push(rawText.slice(nextMarker));
      }
      break;
    }

    const rawBlock = rawText.slice(nextMarker, markerEnd + TOOL_CALL_END.length);
    const blockText = rawText.slice(afterStart, markerEnd);
    const toolCall = parseToolCallBlock(blockText, toolNames, options, projectedCallIndex);
    if (!toolCall) {
      state.visibleParts.push(rawBlock);
    } else {
      state.toolCalls.push(toolCall);
      state.rawToolCallTextParts.push(rawBlock);
      state.removedToolCallText = true;
      projectedCallIndex += 1;
    }
    cursor = markerEnd + TOOL_CALL_END.length;
  }

  return state;
}

function parseToolCallBlock(
  blockText: string,
  toolNames: ReadonlySet<string>,
  options: IGemmaToolCallProjectorOptions,
  projectedCallIndex: number,
): IToolCall | undefined {
  const trimmed = blockText.trim();
  if (!trimmed.startsWith(CALL_PREFIX)) {
    return undefined;
  }

  const callText = trimmed.slice(CALL_PREFIX.length).trimStart();
  const argsStart = callText.indexOf('{');
  if (argsStart <= 0) {
    return undefined;
  }

  const toolName = callText.slice(0, argsStart).trim();
  if (!toolNames.has(toolName)) {
    return undefined;
  }

  const args = new GemmaArgumentParser(callText.slice(argsStart)).parse();
  if (!args) {
    return undefined;
  }

  return {
    id: `${options.callIdPrefix ?? DEFAULT_CALL_ID_PREFIX}_${projectedCallIndex}`,
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

function appendVisibleTail(
  state: IProjectionState,
  tail: string,
  options: IProjectionOptions,
): void {
  if (tail.length === 0) {
    return;
  }

  if (options.final) {
    state.visibleParts.push(tail);
    return;
  }

  const heldLength = longestStartMarkerPrefixSuffixLength(tail);
  state.visibleParts.push(tail.slice(0, tail.length - heldLength));
}

function longestStartMarkerPrefixSuffixLength(text: string): number {
  const maxLength = Math.min(text.length, TOOL_CALL_START.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (TOOL_CALL_START.startsWith(text.slice(text.length - length))) {
      return length;
    }
  }
  return 0;
}

function toPublicProjection(rawText: string, state: IProjectionState): IGemmaToolCallProjection {
  return {
    rawText,
    visibleText: state.visibleParts.join(''),
    toolCalls: state.toolCalls,
    removedToolCallText: state.removedToolCallText,
    ...(state.rawToolCallTextParts.length > 0 && {
      rawToolCallText: state.rawToolCallTextParts.join(''),
    }),
  };
}

function emptyProjection(): IOpenAICompatibleToolCallTextProjection {
  return {
    visibleText: '',
    toolCalls: [],
    removedToolCallText: false,
  };
}
