/**
 * Opt-in prompt and response content for live telemetry. It travels beside the content-free prompt
 * trace, never inside it: a host that asks for no content is handed no text at all.
 */

/** Which text an item carries. Tool arguments and tool output are not captured. */
export type TLivePromptContentKind = 'user-prompt' | 'assistant-response';

/** What the host asked the framework to capture, and the per-item bound it will export. */
export interface ILivePromptContentPolicy {
  readonly userPrompts: boolean;
  readonly assistantResponses: boolean;
  /** Per-item UTF-8 byte bound the host applies after redaction; the framework only pre-truncates. */
  readonly maxBytes: number;
}

/** One captured text of an owner-typed turn. */
export interface ILivePromptContentItem {
  readonly kind: TLivePromptContentKind;
  /** Unredacted text; redaction is the host's job before anything leaves the process. */
  readonly text: string;
  /** UTF-8 byte length of the text before any truncation. */
  readonly originalBytes: number;
  /** The text is shorter than what was typed or produced — a size cut, not an interruption. */
  readonly truncated: boolean;
  /** The response of an interrupted turn: complete as captured, but not the answer the turn would have given. */
  readonly partial?: true;
}

/** The content of one prompt execution, joined to its trace only by the root's identifiers. */
export interface ILivePromptContentBatch {
  readonly schemaVersion: 1;
  readonly root: {
    readonly traceId: string;
    readonly spanId: string;
    readonly endedAt: string;
  };
  readonly items: readonly ILivePromptContentItem[];
}
