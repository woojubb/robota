const START_MARKER = '<|channel>';
const END_MARKER = '<channel|>';
const THOUGHT_LABEL = 'thought';

export interface IGemmaReasoningProjection {
  rawText: string;
  visibleText: string;
  removedReasoning: boolean;
}

interface IProjectionOptions {
  final: boolean;
}

interface IProjectionState {
  visibleParts: string[];
  removedReasoning: boolean;
}

export function projectGemmaReasoningText(rawText: string): IGemmaReasoningProjection {
  const result = projectText(rawText, { final: true });
  return {
    rawText,
    visibleText: result.visibleParts.join(''),
    removedReasoning: result.removedReasoning,
  };
}

export class GemmaReasoningProjector {
  private buffer = '';
  private emittedVisibleText = '';
  private hasRemovedReasoning = false;

  get rawText(): string {
    return this.buffer;
  }

  get removedReasoning(): boolean {
    return this.hasRemovedReasoning;
  }

  project(delta: string): string {
    if (delta.length === 0) {
      return '';
    }

    this.buffer += delta;
    return this.projectVisibleText({ final: false });
  }

  flush(): string {
    return this.projectVisibleText({ final: true });
  }

  private projectVisibleText(options: IProjectionOptions): string {
    const result = projectText(this.buffer, options);
    this.hasRemovedReasoning = this.hasRemovedReasoning || result.removedReasoning;

    const nextVisibleText = result.visibleParts.join('');
    const delta = nextVisibleText.slice(this.emittedVisibleText.length);
    this.emittedVisibleText = nextVisibleText;
    return delta;
  }
}

function projectText(rawText: string, options: IProjectionOptions): IProjectionState {
  const state: IProjectionState = {
    visibleParts: [],
    removedReasoning: false,
  };

  let cursor = 0;
  while (cursor < rawText.length) {
    const nextMarker = rawText.indexOf(START_MARKER, cursor);
    if (nextMarker === -1) {
      appendVisibleTail(state, rawText.slice(cursor), options);
      break;
    }

    appendVisibleTail(state, rawText.slice(cursor, nextMarker), options);
    const afterStart = nextMarker + START_MARKER.length;
    const markerEnd = rawText.indexOf(END_MARKER, afterStart);

    if (markerEnd === -1) {
      if (options.final) {
        state.removedReasoning = true;
      }
      break;
    }

    state.removedReasoning = true;
    cursor = consumeChannelBlock(rawText, afterStart, markerEnd);
  }

  return state;
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

function consumeChannelBlock(rawText: string, afterStart: number, markerEnd: number): number {
  const channelText = rawText.slice(afterStart, markerEnd);
  let cursor = markerEnd + END_MARKER.length;

  if (channelText.trim().length === 0) {
    const followingThoughtLabel = rawText.slice(cursor).match(/^thought(?:\r?\n)*/);
    if (followingThoughtLabel) {
      cursor += followingThoughtLabel[0].length;
    }
    return cursor;
  }

  const channelLabel = channelText.split(/\r?\n/, 1)[0]?.trim();
  if (channelLabel === THOUGHT_LABEL) {
    return cursor;
  }

  return cursor;
}

function longestStartMarkerPrefixSuffixLength(text: string): number {
  const maxLength = Math.min(text.length, START_MARKER.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (START_MARKER.startsWith(text.slice(text.length - length))) {
      return length;
    }
  }
  return 0;
}
