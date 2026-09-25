/**
 * Opt-in prompt, response and tool content for live telemetry, collected only for the turns prompt
 * history records. Nothing here redacts: the host redacts in its export worker. The framework only
 * pre-truncates, with a margin above the host's bound so the host's exact cut happens after
 * redaction has seen the text around it, and bounds what one turn may hold.
 */
import { stringifyBounded, utf8Prefix } from './interactive-session-live-content-bounded.js';
import { isOwnerPromptTurn } from './interactive-session-prompt-history.js';

import type { TToolCallObservedPhase } from './interactive-session-execution.js';
import type { ILivePromptTracePort } from './interactive-session-live-prompt-trace.js';
import type {
  ILivePromptContentBatch,
  ILivePromptContentItem,
  ILivePromptContentPolicy,
  ILivePromptContentToolRef,
  TLivePromptContentKind,
} from '@robota-sdk/agent-interface-analytics';
import type { TDriverId, TTurnSource } from '@robota-sdk/agent-interface-session';

/** Bytes kept beyond the host's per-item bound, so a secret straddling that bound is still whole. */
export const LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES = 1024;
/** Tool items one turn may hold. */
export const LIVE_CONTENT_MAX_TOOL_ITEMS = 128;
/** Captured (pre-redaction) text one turn may hold, prompt and response room included. */
export const LIVE_CONTENT_TURN_TEXT_BUDGET_BYTES = 3 * 1024 * 1024;
const EMPTY_RESPONSE = '(empty response)';

export { utf8Prefix };

function capture(
  kind: ILivePromptContentItem['kind'],
  text: string,
  maxBytes: number,
  partial: boolean,
): ILivePromptContentItem {
  const originalBytes = Buffer.byteLength(text, 'utf8');
  const kept = utf8Prefix(text, maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES);
  return {
    kind,
    text: kept,
    originalBytes,
    truncated: kept.length !== text.length,
    ...(partial ? { partial: true as const } : {}),
  };
}

/** One of the owner turn's own tool calls, as its end event reported it. */
export interface ILiveToolCallContent {
  readonly callId: string;
  readonly name: string;
  readonly outcome: ILivePromptContentToolRef['outcome'];
  readonly args?: unknown;
  /** Absent for a denied call, which has no output; empty for a crashed body. */
  readonly output?: string;
}

interface IPendingToolItem {
  readonly kind: 'tool-arguments' | 'tool-output';
  readonly text: string;
  readonly originalBytes: number;
  readonly truncated: boolean;
  readonly tool: Omit<ILivePromptContentToolRef, 'spanId'>;
}

export class LivePromptContentAccumulator {
  private prompt: ILivePromptContentItem | undefined;
  private response: ILivePromptContentItem | undefined;
  private readonly tools: IPendingToolItem[] = [];
  private toolBytes = 0;
  private readonly omitted: Partial<Record<TLivePromptContentKind, number>> = {};
  /** What tool items may use: the turn budget less the room the prompt and response are promised. */
  private readonly toolBudgetBytes: number;

  constructor(
    private readonly policy: ILivePromptContentPolicy,
    limits: { readonly textBudgetBytes?: number } = {},
  ) {
    const itemBound = policy.maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES;
    const reserved = (policy.userPrompts ? itemBound : 0) + (policy.assistantResponses ? itemBound : 0);
    this.toolBudgetBytes = (limits.textBudgetBytes ?? LIVE_CONTENT_TURN_TEXT_BUDGET_BYTES) - reserved;
  }

  /** Whether any tool gate is on, so the turn needs to know which calls are its own. */
  get capturesTools(): boolean {
    return this.policy.toolArguments === true || this.policy.toolOutput === true;
  }

  addPrompt(text: string): void {
    if (!this.policy.userPrompts || this.prompt || text.trim().length === 0) return;
    this.prompt = capture('user-prompt', text, this.policy.maxBytes, false);
  }

  /** One response per turn; an interrupted turn's text is `partial`, which is not `truncated`. */
  addResponse(text: string | undefined, interrupted: boolean): void {
    if (!this.policy.assistantResponses || this.response || text === undefined) return;
    if (text === EMPTY_RESPONSE || text.trim().length === 0) return;
    this.response = capture('assistant-response', text, this.policy.maxBytes, interrupted);
  }

  /** Called once per owned call; a call past the turn's limits is counted, never captured. */
  addToolCall(call: ILiveToolCallContent): void {
    const tool = { callId: call.callId, name: call.name, outcome: call.outcome };
    const bound = this.policy.maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES;
    if (this.policy.toolArguments === true && call.args !== undefined) {
      this.pushTool('tool-arguments', () => {
        const rendered = stringifyBounded(call.args, bound);
        return { text: rendered.text, originalBytes: rendered.bytes, truncated: rendered.truncated };
      }, tool);
    }
    if (this.policy.toolOutput === true && call.outcome !== 'denied') {
      this.pushTool('tool-output', () => {
        const output = call.output ?? '';
        // Slice before measuring: the bound, not the output, decides what this costs.
        const text = utf8Prefix(output.slice(0, bound), bound);
        return { text, originalBytes: Buffer.byteLength(output, 'utf8'), truncated: text.length !== output.length };
      }, tool);
    }
  }

  private pushTool(
    kind: IPendingToolItem['kind'],
    render: () => Pick<IPendingToolItem, 'text' | 'originalBytes' | 'truncated'>,
    tool: IPendingToolItem['tool'],
  ): void {
    if (this.tools.length >= LIVE_CONTENT_MAX_TOOL_ITEMS) {
      this.omit(kind);
      return;
    }
    let item: Pick<IPendingToolItem, 'text' | 'originalBytes' | 'truncated'>;
    try {
      item = render();
    } catch {
      this.omit(kind);
      return;
    }
    const bytes = Buffer.byteLength(item.text, 'utf8');
    if (this.toolBytes + bytes > this.toolBudgetBytes) {
      this.omit(kind);
      return;
    }
    this.toolBytes += bytes;
    this.tools.push({ kind, ...item, tool });
  }

  private omit(kind: TLivePromptContentKind): void {
    this.omitted[kind] = (this.omitted[kind] ?? 0) + 1;
  }

  /**
   * `toolSpanIds` maps a call to the tool-body span the trace accepted for it; any other tool item
   * belongs to the root span.
   */
  finish(
    root: ILivePromptContentBatch['root'],
    toolSpanIds: ReadonlyMap<string, string> = new Map(),
  ): ILivePromptContentBatch | undefined {
    const items: ILivePromptContentItem[] = [this.prompt, this.response].filter(
      (item): item is ILivePromptContentItem => item !== undefined,
    );
    for (const item of this.tools) {
      const spanId = toolSpanIds.get(item.tool.callId);
      items.push({ ...item, tool: { ...item.tool, ...(spanId !== undefined ? { spanId } : {}) } });
    }
    const omitted = Object.keys(this.omitted).length > 0 ? { omitted: { ...this.omitted } } : {};
    if (items.length === 0 && !omitted.omitted) return undefined;
    return { schemaVersion: 1, root: { ...root }, items, ...omitted };
  }
}

/**
 * Which tool calls are the turn's own. Only a call whose permission or body events reached this
 * turn's collector is owned; a subagent, fork or background run reports its calls through the same
 * tool callback but its events go to its own bus, so it is never captured — even when its call ID
 * collides with an owned one, because an owned call is claimed only once it is denied or its body
 * has completed, and only once.
 */
export class LiveToolCallOwnership {
  private readonly phases = new Map<string, TToolCallObservedPhase>();
  private readonly claimed = new Set<string>();

  observe(toolCallId: string, phase: TToolCallObservedPhase): void {
    this.phases.set(toolCallId, phase);
  }

  /** True exactly once, for an end event that matches what this turn's own events reported. */
  claim(toolCallId: string, denied: boolean): boolean {
    if (this.claimed.has(toolCallId)) return false;
    const phase = this.phases.get(toolCallId);
    if (phase !== (denied ? 'denied' : 'body-completed')) return false;
    this.claimed.add(toolCallId);
    return true;
  }
}

/**
 * Only a host that provided a content port, with a gate on, for an owner-typed turn gets an
 * accumulator. Every other turn copies no text at all.
 */
export function createLivePromptContentAccumulator(
  port: ILivePromptTracePort | undefined,
  turn: { readonly turnSource: TTurnSource; readonly driverId: TDriverId | undefined },
): LivePromptContentAccumulator | undefined {
  const policy = port?.content?.policy;
  if (!policy || (!policy.userPrompts && !policy.assistantResponses &&
    policy.toolArguments !== true && policy.toolOutput !== true)) return undefined;
  if (!isOwnerPromptTurn(turn)) return undefined;
  return new LivePromptContentAccumulator(policy);
}

function reportFailure(port: ILivePromptTracePort, code: 'projection-failed' | 'enqueue-failed'): void {
  try {
    void Promise.resolve(port.onFailure?.(code)).catch(() => undefined);
  } catch {
    // A diagnostic adapter must never alter turn settlement.
  }
}

/** The same isolation as the trace batch: a failing content port never reaches the turn. */
export function enqueueLivePromptContent(
  port: ILivePromptTracePort,
  accumulator: LivePromptContentAccumulator,
  root: ILivePromptContentBatch['root'],
  toolSpanIds?: ReadonlyMap<string, string>,
): void {
  let batch: ILivePromptContentBatch | undefined;
  try {
    batch = accumulator.finish(root, toolSpanIds);
  } catch {
    reportFailure(port, 'projection-failed');
    return;
  }
  const content = port.content;
  if (!batch || !content) return;
  try {
    void Promise.resolve(content.enqueue(batch)).catch(() => reportFailure(port, 'enqueue-failed'));
  } catch {
    reportFailure(port, 'enqueue-failed');
  }
}
