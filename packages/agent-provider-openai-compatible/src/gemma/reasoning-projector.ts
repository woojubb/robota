const START_MARKER = '<|channel>';
const END_MARKER = '<channel|>';
const THOUGHT_LABEL = 'thought';
const CHANNEL_SEPARATOR = '\n\n';

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
  /** Text of the removed channels, in order, without each channel's label line. */
  reasoningParts: string[];
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
  private reasoningText = '';
  private reportedReasoningLength = 0;
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

  /**
   * The removed reasoning text that earlier calls have not handed out yet. It lags the buffer only
   * where the text cannot yet be told apart from the channel label or from the end marker.
   */
  takeReasoning(): string {
    const delta = this.reasoningText.slice(this.reportedReasoningLength);
    this.reportedReasoningLength = Math.max(
      this.reportedReasoningLength,
      this.reasoningText.length,
    );
    return delta;
  }

  private projectVisibleText(options: IProjectionOptions): string {
    const result = projectText(this.buffer, options);
    this.hasRemovedReasoning = this.hasRemovedReasoning || result.removedReasoning;
    this.reasoningText = joinReasoningChannels(result.reasoningParts);

    const nextVisibleText = result.visibleParts.join('');
    const delta = nextVisibleText.slice(this.emittedVisibleText.length);
    this.emittedVisibleText = nextVisibleText;
    return delta;
  }
}

function projectText(rawText: string, options: IProjectionOptions): IProjectionState {
  const state: IProjectionState = {
    visibleParts: [],
    reasoningParts: [],
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
      // The channel is still open: what follows is reasoning, minus a tail that may be the start of
      // the end marker. Once the stream is over nothing more can complete either.
      const body = rawText.slice(afterStart);
      const heldLength = options.final ? 0 : longestEndMarkerPrefixSuffixLength(body);
      state.reasoningParts.push(channelReasoning(body.slice(0, body.length - heldLength)));
      if (options.final) {
        state.removedReasoning = true;
      }
      break;
    }

    state.removedReasoning = true;
    state.reasoningParts.push(channelReasoning(rawText.slice(afterStart, markerEnd)));
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

/**
 * The reasoning of the reply's channels as one text. A reply's channels are separate thoughts (visible
 * text or a tool call sits between them), so each starts on a new paragraph. A channel with no
 * reasoning yet adds nothing, including its break, so the text only ever grows at its end.
 */
function joinReasoningChannels(channels: readonly string[]): string {
  return channels.filter((channel) => channel.trim().length > 0).join(CHANNEL_SEPARATOR);
}

/**
 * The reasoning in a channel body: what follows the channel's first line, which names the channel
 * (`thought`). Nothing is reasoning until that line has ended, so a label is never reported as
 * reasoning and the result only ever grows.
 */
function channelReasoning(body: string): string {
  const lineBreak = /\r?\n/.exec(body);
  if (lineBreak === null) {
    return '';
  }
  return body.slice(lineBreak.index + lineBreak[0].length);
}

function longestEndMarkerPrefixSuffixLength(text: string): number {
  const maxLength = Math.min(text.length, END_MARKER.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (END_MARKER.startsWith(text.slice(text.length - length))) {
      return length;
    }
  }
  return 0;
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
