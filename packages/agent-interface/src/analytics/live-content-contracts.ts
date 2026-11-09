/**
 * Opt-in prompt, response and tool content for live telemetry. It travels beside the content-free
 * prompt trace, never inside it: a host that asks for no content is handed no text at all.
 */

/** Which text an item carries. */
export type TLivePromptContentKind =
  | 'user-prompt'
  | 'assistant-response'
  | 'tool-arguments'
  | 'tool-output';

/** What the host asked the framework to capture, and the per-item bound it will export. */
export interface ILivePromptContentPolicy {
  readonly userPrompts: boolean;
  readonly assistantResponses: boolean;
  /** Arguments of the owner turn's own tool calls, allowed or denied. Absent means off. */
  readonly toolArguments?: boolean;
  /** Output of the owner turn's own allowed tool calls. Absent means off. */
  readonly toolOutput?: boolean;
  /** Per-item UTF-8 byte bound the host applies after redaction; the framework only pre-truncates. */
  readonly maxBytes: number;
}

/** Which of the turn's own tool calls a tool item belongs to. */
export interface ILivePromptContentToolRef {
  readonly callId: string;
  /** Unvalidated tool name; the host exports it only when it is a safe label. */
  readonly name: string;
  readonly outcome: 'success' | 'failure' | 'denied';
  /** The call's exported tool-body span, when the trace kept one; otherwise the root span applies. */
  readonly spanId?: string;
}

/** One captured text of an owner-typed turn. */
export interface ILivePromptContentItem {
  readonly kind: TLivePromptContentKind;
  /** Unredacted text; redaction is the host's job before anything leaves the process. */
  readonly text: string;
  /**
   * UTF-8 byte length of the text before any truncation. For tool arguments whose rendering stopped
   * early at the bound, it is the length rendered so far — a lower bound.
   */
  readonly originalBytes: number;
  /** The text is shorter than what was typed or produced — a size cut, not an interruption. */
  readonly truncated: boolean;
  /** The response of an interrupted turn: complete as captured, but not the answer the turn would have given. */
  readonly partial?: true;
  /** Present exactly on tool items. */
  readonly tool?: ILivePromptContentToolRef;
}

/** Items the framework dropped before export, by kind; a kind with none is absent. */
export type TLivePromptContentOmitted = Readonly<Partial<Record<TLivePromptContentKind, number>>>;

/** The content of one prompt execution, joined to its trace only by the root's identifiers. */
export interface ILivePromptContentBatch {
  readonly schemaVersion: 1;
  readonly root: {
    readonly traceId: string;
    readonly spanId: string;
    readonly endedAt: string;
  };
  /** Prompt, then response, then tool items in call order. */
  readonly items: readonly ILivePromptContentItem[];
  readonly omitted?: TLivePromptContentOmitted;
}
